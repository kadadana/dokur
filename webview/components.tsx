import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Handle,
  Position,
  useUpdateNodeInternals,
  type Connection,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import {
  Box,
  Braces,
  Cable,
  Check,
  CircleAlert,
  Database,
  FileKey2,
  FileText,
  Layers3,
  Link2,
  Network,
  Plus,
  Search,
  Sparkles,
  Workflow,
  X,
  type LucideIcon,
} from 'lucide-react';
import { initialValue, resourceSchema, type Model } from '../src/schema';
import type { Operation } from '../src/protocol';
import { propertyPreview } from '../src/property-model';
import { listen, send } from './bridge';
import { materialFor } from './materials';
import { materialAssetUrl } from './material-images';
import { renderFabric, type FabricRaster } from './fabric-texture';

const kindInfo: Record<
  string,
  { label: string; singular: string; icon: LucideIcon; color: string }
> = {
  services: { label: 'Services', singular: 'Service', icon: Box, color: '#8f9aff' },
  networks: { label: 'Networks', singular: 'Network', icon: Network, color: '#62cfb5' },
  volumes: { label: 'Volumes', singular: 'Volume', icon: Database, color: '#e4ba77' },
  secrets: { label: 'Secrets', singular: 'Secret', icon: FileKey2, color: '#df95bc' },
  configs: { label: 'Configs', singular: 'Config', icon: FileText, color: '#85bbeb' },
  models: { label: 'Models', singular: 'Model', icon: Sparkles, color: '#b5a0e8' },
  jobs: { label: 'Jobs', singular: 'Job', icon: Workflow, color: '#d5a485' },
};
const info = (kind: string) =>
  kindInfo[kind] ?? { label: kind, singular: kind, icon: Braces, color: '#8f9aff' };
const parts = (id: string) => id.split('/');
type ResourceData = {
  kind: string;
  name: string;
  config: any;
  issues: number;
  outgoing: number;
  [key: string]: unknown;
};
type ResourceNode = Node<ResourceData, 'resource'>;

export function ResourceCard({ id, data, selected }: NodeProps<ResourceNode>) {
  const material = materialFor(data.kind);
  const meta = { ...info(data.kind), color: material.accent };
  const Icon = meta.icon;
  const config = data.config ?? {};
  const [expanded, setExpanded] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const updateNodeInternals = useUpdateNodeInternals();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [fabric, setFabric] = useState<FabricRaster>();
  useLayoutEffect(() => {
    if (!card.current) return;
    const observer = new ResizeObserver(() => {
      const width = Math.round(card.current!.offsetWidth),
        height = Math.round(card.current!.offsetHeight);
      setSize((old) => (old.width === width && old.height === height ? old : { width, height }));
    });
    observer.observe(card.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!size.width || !size.height) return;
    let active = true;
    void renderFabric(data.kind, size.width, size.height)
      .then((value) => {
        if (active) setFabric(value);
      })
      .catch(() => {
        /* A plain surface remains available if a local material fails to load. */
      });
    return () => {
      active = false;
    };
  }, [data.kind, size.width, size.height]);
  useLayoutEffect(() => {
    updateNodeInternals(id);
  }, [id, updateNodeInternals, fabric, size.width, size.height]);
  const handleStyle = (side: Position) => ({ [side]: fabric?.ports[side] ?? 0 });
  const configured =
    config && typeof config === 'object'
      ? Object.entries(config).filter(([key]) => key !== 'image')
      : [];
  const visible = expanded ? configured : configured.slice(0, 4);
  const workload = data.kind === 'services' || data.kind === 'jobs';
  return (
    <div
      ref={card}
      className={`resource-card ${selected ? 'is-selected' : ''} ${workload ? 'workload' : 'resource'}`}
      data-material={data.kind}
      style={
        {
          '--node-color': meta.color,
          '--fabric-opacity': material.opacity,
          '--fabric-mask': fabric ? `url("${fabric.url}")` : 'none',
          '--thread-texture': `url("${materialAssetUrl(material.rope)}")`,
        } as React.CSSProperties
      }
    >
      <div className={`fabric-surface ${fabric ? '' : 'fabric-loading'}`} aria-hidden="true">
        <div className="fabric-base" />
        {fabric && <img className="fabric-photo" src={fabric.url} alt="" draggable={false} />}
      </div>
      <Handle
        className="connection-handle"
        type={workload ? 'source' : 'target'}
        position={Position.Left}
        style={handleStyle(Position.Left)}
        id={workload ? 'source-left' : 'target'}
        isConnectableStart={workload}
        title={workload ? 'Drag to connect · Drop a connection here' : 'Drop a connection here'}
      />
      {[Position.Left, Position.Right, Position.Top, Position.Bottom].map((side) => (
        <Handle
          key={`in-${side}`}
          className="route-handle"
          type="target"
          position={side}
          style={handleStyle(side)}
          id={`in-${side}`}
          isConnectable={false}
        />
      ))}
      {workload &&
        [Position.Left, Position.Right, Position.Top, Position.Bottom].map((side) => (
          <Handle
            key={`out-${side}`}
            className="route-handle"
            type="source"
            position={side}
            style={handleStyle(side)}
            id={`out-${side}`}
            isConnectable={false}
          />
        ))}
      <div className="fabric-content" style={{ clipPath: fabric?.clipPath }}>
        <div className="node-top">
          <span className="node-icon">
            <Icon size={19} />
          </span>
          <div className="node-heading">
            <span className="node-kind">{meta.singular}</span>
            <strong>{data.name}</strong>
          </div>
          <span
            className={`node-state ${data.issues ? 'has-issues' : ''}`}
            title={data.issues ? `${data.issues} validation issues` : 'Declared in this file'}
          >
            {data.issues ? <CircleAlert size={13} /> : <Check size={13} />}
          </span>
        </div>
        {workload ? (
          <>
            <div className="node-image">
              <Layers3 size={12} />
              <span>
                {config.image || (config.build ? 'Local Dockerfile' : 'No image configured')}
              </span>
            </div>
            <div className="node-bottom">
              <span>
                <>
                  <Cable size={11} />
                  {data.outgoing} connections
                </>
              </span>
              <span className="node-kind-tag">{data.kind === 'jobs' ? 'JOB' : 'CONTAINER'}</span>
            </div>
          </>
        ) : !configured.length ? (
          <div className="resource-detail">
            {config.external
              ? 'External resource'
              : data.kind === 'networks'
                ? config.driver || 'Default driver'
                : data.kind === 'volumes'
                  ? config.driver || 'Persistent storage'
                  : data.kind === 'models'
                    ? config.model || 'Model reference'
                    : config.file || config.environment || 'Managed resource'}
          </div>
        ) : null}
        {!!configured.length && (
          <div className="node-properties">
            <dl>
              {visible.map(([key, value]) => (
                <div className="node-property" key={key}>
                  <dt>{key}</dt>
                  <dd title={propertyPreview(value)}>{propertyPreview(value)}</dd>
                </div>
              ))}
            </dl>
            {configured.length > 4 && (
              <button
                className="node-expand nodrag nopan"
                onClick={(event) => {
                  event.stopPropagation();
                  setExpanded(!expanded);
                }}
              >
                {expanded ? 'Show fewer properties' : `Show all ${configured.length} properties`}
              </button>
            )}
          </div>
        )}
      </div>
      <Handle
        className="connection-handle"
        type={workload ? 'source' : 'target'}
        position={Position.Right}
        style={handleStyle(Position.Right)}
        id={workload ? 'source' : 'target-right'}
        isConnectableStart={workload}
        title={workload ? 'Drag to connect · Drop a connection here' : 'Drop a connection here'}
      />
    </div>
  );
}

export function CreateDialog({
  kind,
  model,
  onCreate,
  onClose,
  source,
}: {
  kind: string;
  model: Model;
  source?: string;
  onCreate: (name: string, value: any, mount?: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [image, setImage] = useState('');
  const [hub, setHub] = useState(false);
  const imageRequest = useRef('');
  const [mount, setMount] = useState('/data');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    return listen((message) => {
      if (message.type !== 'imagePicked' || message.requestId !== imageRequest.current) return;
      imageRequest.current = '';
      setHub(false);
      if (message.image !== undefined) setImage(message.image);
    });
  }, []);
  const meta = info(kind);
  const Icon = meta.icon;
  const validName =
    /^[a-zA-Z0-9._-]+$/.test(name) &&
    !['__proto__', 'constructor', 'prototype'].includes(name) &&
    !Object.hasOwn(model[kind] ?? {}, name);
  const valid = validName && (!source || kind !== 'volumes' || mount.startsWith('/'));
  function create() {
    if (!valid) return;
    let value = initialValue(resourceSchema(kind));
    if (kind === 'services' || kind === 'jobs')
      value = {
        ...(image.trim() ? { image: image.trim() } : {}),
        ...(kind === 'jobs' ? { triggers: { manual: true } } : {}),
      };
    if (kind === 'configs' || kind === 'secrets') value = { file: `./${kind}/${name}` };
    onCreate(name, value, source && kind === 'volumes' ? mount : undefined);
    onClose();
  }
  return (
    <>
      <dialog ref={dialog} className="create-dialog" onCancel={onClose}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            create();
          }}
        >
          <div className="modal-header">
            <span className="modal-icon" style={{ color: meta.color }}>
              <Icon size={23} />
            </span>
            <div>
              <h2>Add a {meta.singular.toLowerCase()}</h2>
              <p>
                {source
                  ? `Connect from ${source.split('/')[1]}`
                  : 'A new building block for your stack.'}
              </p>
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label="Close create dialog"
              onClick={onClose}
            >
              <X size={18} />
            </button>
          </div>
          <div className="create-body">
            <label className="form-label" htmlFor="resource-name">
              NAME
            </label>
            <input
              id="resource-name"
              autoFocus
              placeholder={
                kind === 'services'
                  ? 'e.g. api, frontend, database'
                  : `e.g. ${kind === 'networks' ? 'backend' : kind === 'volumes' ? 'app-data' : 'my-' + meta.singular.toLowerCase()}`
              }
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            {name && !validName && (
              <span className="field-error">
                Choose a unique name using letters, numbers, dots, underscores, or hyphens.
              </span>
            )}
            {(kind === 'services' || kind === 'jobs') && (
              <>
                <div className="image-label">
                  <label className="form-label" htmlFor="resource-image">
                    CONTAINER IMAGE
                  </label>
                  <button
                    type="button"
                    className="text-button"
                    disabled={hub}
                    onClick={() => {
                      const requestId = `image-${crypto.randomUUID()}`;
                      imageRequest.current = requestId;
                      setHub(true);
                      send({ type: 'pickImage', requestId, current: image });
                    }}
                  >
                    <Search size={12} /> Search Docker Hub
                  </button>
                </div>
                <input
                  id="resource-image"
                  placeholder="e.g. nginx:alpine, or configure build later"
                  value={image}
                  onChange={(event) => setImage(event.target.value)}
                />
                <p className="field-help">Use any registry, local image, tag, or digest.</p>
              </>
            )}
          </div>
          {source && kind === 'volumes' && (
            <div className="create-body mount-create">
              <label className="form-label" htmlFor="new-mount-path">
                CONTAINER PATH
              </label>
              <input
                id="new-mount-path"
                value={mount}
                onChange={(event) => setMount(event.target.value)}
              />
              <p className="field-help">
                Absolute path inside {source.split('/')[1]}, for example /data.
              </p>
            </div>
          )}
          <div className="create-footer">
            <button type="button" className="secondary-button" onClick={onClose}>
              Cancel
            </button>
            <button className="primary-button" disabled={!valid}>
              Add {meta.singular.toLowerCase()}
              <Plus size={14} />
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}

export function MountDialog({
  connection,
  edit,
  onClose,
}: {
  connection: Connection;
  edit: (op: Operation) => void;
  onClose: () => void;
}) {
  const [mount, setMount] = useState('/data');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const [sourceKind, source] = parts(connection.source);
  const [targetKind, target] = parts(connection.target);
  return (
    <dialog ref={dialog} className="create-dialog" onCancel={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          edit({ type: 'connect', sourceKind, source, targetKind, target, mount });
          onClose();
        }}
      >
        <div className="modal-header">
          <span className="modal-icon">
            <Database size={22} />
          </span>
          <div>
            <h2>Mount {target}</h2>
            <p>Choose where {source} will access this volume.</p>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close mount dialog"
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </div>
        <div className="create-body">
          <label className="form-label" htmlFor="mount-path">
            CONTAINER PATH
          </label>
          <input
            autoFocus
            id="mount-path"
            value={mount}
            onChange={(event) => setMount(event.target.value)}
          />
          <p className="field-help">
            An absolute path inside the container, such as /var/lib/postgresql/data.
          </p>
        </div>
        <div className="create-footer">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" disabled={!mount.startsWith('/')}>
            Connect volume <Link2 size={13} />
          </button>
        </div>
      </form>
    </dialog>
  );
}
