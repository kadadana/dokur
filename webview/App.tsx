import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Controls,
  ConnectionLineType,
  ConnectionMode,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type XYPosition,
} from '@xyflow/react';
import {
  ArrowRight,
  Box,
  CircleAlert,
  Database,
  LayoutGrid,
  Link2,
  Maximize2,
  Network,
  Plus,
  ShieldCheck,
  Unplug,
  X,
} from 'lucide-react';
import { resourceKinds } from '../src/schema';
import { relationField, relations, wouldCycle, type Relation } from '../src/relations';
import type { Operation, Snapshot } from '../src/protocol';
import { listen, persistState, readState, send } from './bridge';
import { CreateDialog, MountDialog, ResourceCard } from './components';
import { BendableEdge, type RouteEdge } from './BendableEdge';
import { materialFor } from './materials';

type ResourceNode = Node<
  {
    kind: string;
    name: string;
    config: any;
    issues: number;
    outgoing: number;
    [key: string]: unknown;
  },
  'resource'
>;
type CreateRequest = { kind: string; sourceId?: string; position?: XYPosition };
type Placement = { id: string; position: XYPosition };
const nodeTypes = { resource: ResourceCard };
const edgeTypes = { bendable: BendableEdge };
const linenBackdrop = (
  <svg className="linen-backdrop" aria-hidden="true" focusable="false">
    <defs>
      <pattern id="dokur-linen" width="8" height="8" patternUnits="userSpaceOnUse">
        <g fill="none" stroke="currentColor">
          <path opacity="0.62" d="M2.5 0v1M2.5 4v4M6.5 0v5" />
          <path d="M0 2.5h5M0 6.5h1M4 6.5h4" />
          <path opacity="0.24" d="M0 3.5h5M0 7.5h1M4 7.5h4M3.5 4v4M7.5 0v5" />
        </g>
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#dokur-linen)" />
  </svg>
);
const idFor = (kind: string, name: string) => `${kind}/${name}`;
const singular = (kind: string) => kind.replace(/s$/, '');

function defaultPositions(state: Snapshot) {
  const result: Record<string, XYPosition> = {};
  let workload = 0;
  let resource = 0;
  const total =
    Object.keys(state.model.services ?? {}).length + Object.keys(state.model.jobs ?? {}).length;
  for (const kind of resourceKinds)
    for (const name of Object.keys(state.model[kind] ?? {})) {
      const isWorkload = kind === 'services' || kind === 'jobs';
      const index = isWorkload ? workload++ : resource++;
      result[idFor(kind, name)] = isWorkload
        ? { x: 80 + (index % 3) * 420, y: 65 + (index % 3) * 115 + Math.floor(index / 3) * 410 }
        : {
            x: 245 + (index % 3) * 420,
            y: 205 + Math.ceil(total / 3) * 440 + (index % 3) * 45 + Math.floor(index / 3) * 290,
          };
    }
  return result;
}

function Canvas({
  state,
  disabled,
  edit,
  select,
  create,
  connect,
  placement,
}: {
  state: Snapshot;
  disabled: boolean;
  edit: (op: Operation) => void;
  select: (id: string) => void;
  create: (request: CreateRequest) => void;
  connect: (connection: Connection) => void;
  placement?: Placement;
}) {
  const flow = useReactFlow();
  const [nodes, setNodes] = useState<ResourceNode[]>([]);
  const [edge, setEdge] = useState<{ id: string; relation: Relation }>();
  const [menu, setMenu] = useState(false);
  const [drop, setDrop] = useState<{
    sourceId: string;
    screen: XYPosition;
    position: XYPosition;
  }>();
  const [bends, setBends] = useState<Record<string, XYPosition>>(readState().bends ?? {});
  const bendRef = useRef(bends);
  bendRef.current = bends;
  const positions = useRef<Record<string, XYPosition>>(
    readState().layoutVersion === 3 ? (readState().positions ?? {}) : {},
  );
  const wrap = useRef<HTMLDivElement>(null);
  const fitted = useRef(false);
  const selected = state.selected ?? '@project';
  const allRelations = useMemo(() => relations(state.model), [state.model]);
  const [selectedKind, selectedName] = selected.split('/');
  const focusId =
    resourceKinds.includes(selectedKind) &&
    Object.hasOwn(state.model[selectedKind] ?? {}, selectedName)
      ? selected
      : undefined;
  const focusedTargets = new Set(
    allRelations
      .filter((r) => idFor(r.sourceKind, r.source) === focusId)
      .map((r) => idFor(r.targetKind, r.target)),
  );
  const persist = () =>
    persistState({ layoutVersion: 3, positions: positions.current, bends: bendRef.current });
  useEffect(() => {
    if (placement) {
      positions.current[placement.id] = placement.position;
      persist();
    }
    const defaults = defaultPositions(state);
    const list: ResourceNode[] = resourceKinds.flatMap((kind) =>
      Object.entries(state.model[kind] ?? {}).map(([name, config]) => {
        const id = idFor(kind, name);
        return {
          id,
          type: 'resource' as const,
          style: { pointerEvents: 'none' as const },
          position: positions.current[id] ?? defaults[id],
          selected: id === selected,
          className:
            focusId && id !== focusId && !focusedTargets.has(id) ? 'is-unrelated' : undefined,
          data: {
            kind,
            name,
            config,
            issues: state.issues.filter((issue) => issue.path[0] === kind && issue.path[1] === name)
              .length,
            outgoing: allRelations.filter((r) => r.sourceKind === kind && r.source === name).length,
          },
        };
      }),
    );
    setNodes((previous) =>
      list.map((node) => ({
        ...node,
        position:
          positions.current[node.id] ??
          previous.find((old) => old.id === node.id)?.position ??
          node.position,
      })),
    );
    if (list.length && !fitted.current) {
      fitted.current = true;
      setTimeout(() => flow.fitView({ padding: 0.18, maxZoom: 1, duration: 0 }), 80);
    }
  }, [state, placement]);
  useEffect(() => {
    if (!drop && !menu) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDrop(undefined);
        setMenu(false);
      }
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [drop, menu]);
  const groupedRelations = useMemo(() => {
    const grouped = new Map<string, { relation: Relation; count: number }>();
    for (const r of allRelations) {
      if (!Object.hasOwn(state.model[r.targetKind] ?? {}, r.target)) continue;
      const id = `${idFor(r.sourceKind, r.source)}->${idFor(r.targetKind, r.target)}`;
      const current = grouped.get(id);
      if (current) {
        current.count++;
        if (r.path.length === 4) current.relation = r;
      } else grouped.set(id, { relation: r, count: 1 });
    }
    return [...grouped];
  }, [allRelations, state.model]);
  const edges = useMemo<RouteEdge[]>(() => {
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    return groupedRelations.map(([id, { relation: r, count }]) => {
      const materialKind = r.sourceKind === 'jobs' ? 'jobs' : r.targetKind;
      const color = materialFor(materialKind).accent;
      const sourceNode = nodesById.get(idFor(r.sourceKind, r.source));
      const targetNode = nodesById.get(idFor(r.targetKind, r.target));
      const dx = (targetNode?.position.x ?? 0) - (sourceNode?.position.x ?? 0);
      const dy = (targetNode?.position.y ?? 0) - (sourceNode?.position.y ?? 0);
      const vertical = Math.abs(dy) > Math.abs(dx) * 0.8;
      const sourceSide = vertical ? (dy > 0 ? 'bottom' : 'top') : dx > 0 ? 'right' : 'left';
      const targetSide = vertical ? (dy > 0 ? 'top' : 'bottom') : dx > 0 ? 'left' : 'right';
      const focused = idFor(r.sourceKind, r.source) === focusId;
      return {
        id,
        source: idFor(r.sourceKind, r.source),
        target: idFor(r.targetKind, r.target),
        sourceHandle: `out-${sourceSide}`,
        targetHandle: `in-${targetSide}`,
        type: 'bendable',
        selected: edge?.id === id,
        className: focused ? 'is-focused' : focusId && edge?.id !== id ? 'is-unrelated' : undefined,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color,
          width: 36,
          height: 36,
          markerUnits: 'userSpaceOnUse',
        },
        label: r.field + (count > 1 ? ` · ${count}` : ''),
        deletable: false,
        style: {
          stroke: color,
          strokeWidth: focused || edge?.id === id ? 9 : 8,
          '--edge-color': color,
        } as React.CSSProperties,
        labelBgStyle: { fill: 'var(--vscode-editor-background, #1e1e1e)' },
        data: {
          materialKind,
          relation: r,
          bend: bends[id],
          moving: Boolean(sourceNode?.dragging || targetNode?.dragging),
          onBend: (point?: XYPosition, preview?: boolean) => {
            const next = { ...bendRef.current };
            if (point) next[id] = point;
            else delete next[id];
            bendRef.current = next;
            setBends(next);
            if (!preview) persist();
          },
          onBendEnd: persist,
        },
      };
    });
  }, [groupedRelations, nodes, bends, edge?.id, focusId]);
  const validConnection = (connection: Connection | Edge) => {
    const [sourceKind, source] = connection.source.split('/');
    const [targetKind, target] = connection.target.split('/');
    return (
      !disabled &&
      connection.source !== connection.target &&
      !!relationField(sourceKind, targetKind) &&
      !(
        sourceKind === 'services' &&
        targetKind === 'services' &&
        wouldCycle(state.model, source, target)
      ) &&
      !(targetKind === 'networks' && state.model[sourceKind]?.[source]?.network_mode)
    );
  };
  const arrange = () => {
    positions.current = defaultPositions(state);
    bendRef.current = {};
    setBends({});
    persist();
    setNodes((previous) =>
      previous.map((node) => ({ ...node, position: positions.current[node.id] })),
    );
    setTimeout(() => flow.fitView({ padding: 0.18, maxZoom: 1, duration: 180 }), 30);
  };
  const allowed = drop
    ? resourceKinds.filter((kind) => relationField(drop.sourceId.split('/')[0], kind))
    : [];
  return (
    <main className="canvas-surface">
      <div className="canvas-toolbar">
        <span className="canvas-document">
          {state.filename}
          <span>
            {nodes.length} resources · {allRelations.length} connections
          </span>
        </span>
        <div className="canvas-actions">
          <button
            className="icon-button"
            title="Arrange nodes"
            aria-label="Arrange nodes"
            onClick={arrange}
          >
            <LayoutGrid size={15} />
          </button>
          <button
            className="icon-button"
            title="Fit to view"
            aria-label="Fit to view"
            onClick={() => flow.fitView({ padding: 0.18, maxZoom: 1, duration: 180 })}
          >
            <Maximize2 size={15} />
          </button>
          <div className="add-menu-container">
            <button
              className="secondary-button"
              aria-label="Add resource"
              disabled={disabled}
              onClick={() => setMenu(!menu)}
            >
              <Plus size={14} />
              Add resource
            </button>
            {menu && (
              <>
                <button
                  className="menu-dismiss"
                  aria-label="Close resource menu"
                  onClick={() => setMenu(false)}
                />
                <div className="add-menu">
                  {resourceKinds.map((kind) => (
                    <button
                      key={kind}
                      onClick={() => {
                        create({ kind });
                        setMenu(false);
                      }}
                    >
                      <Plus size={13} />
                      {kind}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="canvas-wrap" ref={wrap}>
        <ReactFlow<ResourceNode, RouteEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          connectionMode={ConnectionMode.Loose}
          onNodesChange={(changes: NodeChange<ResourceNode>[]) =>
            setNodes((previous) => applyNodeChanges(changes, previous))
          }
          onNodeClick={(_, node) => {
            setEdge(undefined);
            select(node.id);
          }}
          onPaneClick={() => {
            setEdge(undefined);
            select('@project');
          }}
          onMoveStart={() => wrap.current?.classList.add('viewport-moving')}
          onMoveEnd={() => wrap.current?.classList.remove('viewport-moving')}
          onNodeDragStart={() => wrap.current?.classList.add('node-moving')}
          onNodeDragStop={(_, node) => {
            wrap.current?.classList.remove('node-moving');
            positions.current[node.id] = node.position;
            persist();
          }}
          onConnectStart={() => {
            setDrop(undefined);
            setMenu(false);
          }}
          onConnect={connect}
          onConnectEnd={(event, connection) => {
            if (
              disabled ||
              connection.isValid ||
              connection.toNode ||
              connection.fromHandle?.type !== 'source' ||
              !connection.fromNode ||
              !(event.target instanceof Element) ||
              !event.target.closest('.react-flow__pane')
            )
              return;
            const point = 'changedTouches' in event ? event.changedTouches[0] : event;
            const rect = wrap.current!.getBoundingClientRect();
            const screen = {
              x: Math.max(8, Math.min(point.clientX - rect.left, rect.width - 225)),
              y: Math.max(8, Math.min(point.clientY - rect.top, rect.height - 290)),
            };
            const position = flow.screenToFlowPosition({ x: point.clientX, y: point.clientY });
            setDrop({
              sourceId: connection.fromNode.id,
              screen,
              position: {
                x: position.x - (connection.fromNode.measured.width ?? 300) / 2,
                y: position.y - 60,
              },
            });
          }}
          isValidConnection={validConnection}
          connectionLineType={ConnectionLineType.Bezier}
          onEdgeClick={(_, edge) =>
            setEdge({ id: edge.id, relation: edge.data!.relation as Relation })
          }
          onEdgesChange={(changes) => {
            const selection = changes.find((change) => change.type === 'select' && change.selected);
            if (selection?.type === 'select') {
              const selected = edges.find((item) => item.id === selection.id);
              if (selected)
                setEdge({ id: selected.id, relation: selected.data!.relation as Relation });
            } else if (
              changes.some(
                (change) => change.type === 'select' && change.id === edge?.id && !change.selected,
              )
            )
              setEdge(undefined);
          }}
          minZoom={0.25}
          maxZoom={1.6}
          nodesConnectable={!disabled}
          deleteKeyCode={null}
          proOptions={{ hideAttribution: true }}
        >
          {linenBackdrop}
          <Controls showInteractive={false} />
        </ReactFlow>
        {!nodes.length && (
          <div className="empty-canvas">
            <div className="empty-illustration">
              <span>
                <Box size={30} />
              </span>
              <i />
              <span>
                <Database size={24} />
              </span>
              <i />
              <span>
                <Network size={24} />
              </span>
            </div>
            <h1>Build your Compose stack.</h1>
            <p>
              Add a service, then connect its resources.
              <br />
              Select a node to inspect its native property tree.
            </p>
            <button
              className="primary-button"
              disabled={disabled}
              onClick={() => create({ kind: 'services' })}
            >
              <Plus size={15} />
              Add your first service
            </button>
            <span className="empty-footnote">
              <ShieldCheck size={12} />
              Compose schema driven
            </span>
          </div>
        )}
        {!!nodes.length && (
          <div className="canvas-tip">
            <Link2 size={12} />
            <span>Drop an arrow on empty space to add a resource · Select an edge to bend it</span>
          </div>
        )}
        {drop && (
          <>
            <button
              className="menu-dismiss"
              aria-label="Cancel connected resource"
              onClick={() => setDrop(undefined)}
            />
            <div
              className="connection-menu"
              role="menu"
              aria-label="Add connected resource"
              style={{ left: drop.screen.x, top: drop.screen.y }}
            >
              <div>
                Connect from <strong>{drop.sourceId.split('/')[1]}</strong>
              </div>
              {allowed.map((kind) => (
                <button
                  key={kind}
                  role="menuitem"
                  onClick={() => {
                    create({ kind, sourceId: drop.sourceId, position: drop.position });
                    setDrop(undefined);
                  }}
                >
                  <Plus size={13} />
                  Add {singular(kind)}
                </button>
              ))}
            </div>
          </>
        )}
        {edge && (
          <div className="edge-popover">
            <span>
              {edge.relation.source}
              <ArrowRight size={11} />
              {edge.relation.target}
            </span>
            <small>Drag the curve point to bend</small>
            {edge.relation.path.length === 4 && (
              <button
                className="text-button danger"
                disabled={disabled}
                onClick={() => {
                  const r = edge.relation;
                  edit({
                    type: 'disconnect',
                    sourceKind: r.sourceKind,
                    source: r.source,
                    targetKind: r.targetKind,
                    target: r.target,
                  });
                  setEdge(undefined);
                }}
              >
                <Unplug size={13} />
                Disconnect
              </button>
            )}
            <button
              className="icon-button"
              aria-label="Close connection"
              onClick={() => setEdge(undefined)}
            >
              <X size={13} />
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

function Surface() {
  const [state, setState] = useState<Snapshot>();
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [error, setError] = useState('');
  const [createRequest, setCreateRequest] = useState<CreateRequest>();
  const [placement, setPlacement] = useState<Placement>();
  const [mount, setMount] = useState<Connection>();
  const stateRef = useRef(state);
  useEffect(() => {
    const stop = listen((message) => {
      if (message.type === 'snapshot') {
        if (
          stateRef.current &&
          message.documentId === stateRef.current.documentId &&
          message.version < stateRef.current.version
        )
          return;
        if (stateRef.current?.documentId !== message.documentId) {
          setCreateRequest(undefined);
          setPlacement(undefined);
          setMount(undefined);
          setError('');
        }
        stateRef.current = message;
        setState(message);
        setPending(false);
        pendingRef.current = false;
      }
      if (message.type === 'error') {
        setError(message.message);
        setPending(false);
        pendingRef.current = false;
      }
      if (
        message.type === 'ui' &&
        (!message.documentId || message.documentId === stateRef.current?.documentId)
      ) {
        if (message.action === 'create' && resourceKinds.includes(message.kind ?? ''))
          setCreateRequest({ kind: message.kind! });
        if (message.action === 'mount' && message.sourceId && message.targetId)
          setMount({
            source: message.sourceId,
            target: message.targetId,
            sourceHandle: 'source',
            targetHandle: 'target',
          });
      }
    });
    send({ type: 'ready' });
    return stop;
  }, []);
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(''), 9000);
    return () => clearTimeout(timer);
  }, [error]);
  const message = (value: any) => send({ ...value, documentId: stateRef.current?.documentId });
  const edit = (operation: Operation) => {
    if (!stateRef.current?.editable || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError('');
    message({ type: 'edit', operation, version: stateRef.current.version });
  };
  const connect = (connection: Connection) => {
    const [sourceKind, source] = connection.source.split('/');
    const [targetKind, target] = connection.target.split('/');
    if (targetKind === 'volumes') setMount(connection);
    else edit({ type: 'connect', sourceKind, source, targetKind, target });
  };
  if (!state) return <div className="surface-welcome">Opening Compose…</div>;
  const disabled = pending || !state.editable;
  return (
    <div className="editor-surface">
      <Canvas
        key={state.documentId ?? 'preview'}
        state={state}
        disabled={disabled}
        edit={edit}
        select={(id) => message({ type: 'select', id })}
        create={setCreateRequest}
        connect={connect}
        placement={placement}
      />
      {error && (
        <div className="toast" role="alert">
          <CircleAlert size={16} />
          <span>{error}</span>
          <button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}>
            <X size={14} />
          </button>
        </div>
      )}
      {!state.editable && (
        <div className="syntax-banner">
          <CircleAlert size={14} />
          <span>Fix the YAML syntax to edit visually.</span>
          <button className="text-button" onClick={() => message({ type: 'source' })}>
            Open YAML
          </button>
        </div>
      )}
      {createRequest && (
        <CreateDialog
          kind={createRequest.kind}
          source={createRequest.sourceId}
          model={state.model}
          onClose={() => setCreateRequest(undefined)}
          onCreate={(name, value, mount) => {
            const request = createRequest;
            if (request.position)
              setPlacement({ id: idFor(request.kind, name), position: request.position });
            if (request.sourceId) {
              const [sourceKind, source] = request.sourceId.split('/');
              edit({
                type: 'createConnected',
                sourceKind,
                source,
                targetKind: request.kind,
                name,
                value,
                mount,
              });
            } else edit({ type: 'set', path: [request.kind, name], value });
          }}
        />
      )}
      {mount && <MountDialog connection={mount} edit={edit} onClose={() => setMount(undefined)} />}
    </div>
  );
}
export default function App() {
  return (
    <ReactFlowProvider>
      <Surface />
    </ReactFlowProvider>
  );
}
