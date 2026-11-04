import { useEffect, useRef, useState } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  EdgeText,
  getBezierPath,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type XYPosition,
} from '@xyflow/react';
import { renderRope, type RopeRaster } from './rope-texture';
export type RouteData = {
  bend?: XYPosition;
  materialKind?: string;
  moving?: boolean;
  onBend: (point?: XYPosition, preview?: boolean) => void;
  onBendEnd: () => void;
  [key: string]: unknown;
};
export type RouteEdge = Edge<RouteData, 'bendable'>;

export function BendableEdge(props: EdgeProps<RouteEdge>) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected } =
    props;
  const flow = useReactFlow();
  const dragging = useRef(false);
  const [bending, setBending] = useState(false);
  const [automatic, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    curvature: 0.4,
  });
  const bend = data?.bend;
  // Make the draggable point the midpoint of the cubic, so the curve follows the pointer.
  const cx = bend ? ((bend.x - (sourceX + targetX) / 8) * 4) / 3 : 0;
  const cy = bend ? ((bend.y - (sourceY + targetY) / 8) * 4) / 3 : 0;
  const path = bend
    ? `M${sourceX},${sourceY} C${cx},${cy} ${cx},${cy} ${targetX},${targetY}`
    : automatic;
  const x = bend?.x ?? labelX;
  const y = bend?.y ?? labelY;
  const diameter = Number(props.style?.strokeWidth) || 6;
  const materialKind = data?.materialKind ?? 'configs';
  const moving = bending || data?.moving;
  const [rendered, setRendered] = useState<{
    path: string;
    diameter: number;
    materialKind: string;
    raster: RopeRaster;
  }>();
  const rope =
    !moving &&
    rendered?.path === path &&
    rendered.diameter === diameter &&
    rendered.materialKind === materialKind
      ? rendered.raster
      : undefined;
  useEffect(() => {
    if (moving) return;
    const controller = new AbortController();
    // Keyboard moves and successive layout updates can also change the path rapidly.
    const timer = setTimeout(() => {
      void renderRope(path, diameter, materialKind, controller.signal)
        .then((raster) => {
          if (raster && !controller.signal.aborted)
            setRendered({ path, diameter, materialKind, raster });
        })
        .catch(() => {
          /* The SVG stroke remains usable if the local material fails. */
        });
    }, 100);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [path, diameter, materialKind, moving]);
  const finishBend = () => {
    if (!dragging.current) return;
    dragging.current = false;
    setBending(false);
    data?.onBendEnd();
  };
  const color = props.style?.stroke ?? '#929bf2';
  const ropeStyle = { '--edge-color': color } as React.CSSProperties;
  return (
    <>
      <g className="rope-edge" style={ropeStyle}>
        <BaseEdge
          id={props.id}
          path={path}
          markerEnd={props.markerEnd}
          style={{ ...props.style, stroke: rope ? 'transparent' : color }}
          interactionWidth={22}
        />
        {rope && (
          <image
            href={rope.url}
            x={rope.x}
            y={rope.y}
            width={rope.width}
            height={rope.height}
            preserveAspectRatio="none"
            className="rope-photo"
            data-material={materialKind}
            aria-hidden="true"
            pointerEvents="none"
          />
        )}
        <EdgeText
          label={props.label}
          x={x}
          y={y - (selected ? 18 : 0)}
          labelStyle={props.labelStyle}
          labelShowBg
          labelBgStyle={props.labelBgStyle}
          labelBgPadding={[8, 5]}
          labelBgBorderRadius={4}
        />
      </g>
      {selected && (
        <EdgeLabelRenderer>
          <button
            className="bend-handle nodrag nopan"
            aria-label="Bend connection"
            title="Drag to bend · Double-click to reset"
            style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }}
            onPointerDown={(event) => {
              event.stopPropagation();
              dragging.current = true;
              setBending(true);
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (dragging.current)
                data?.onBend(
                  flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
                  true,
                );
            }}
            onPointerUp={finishBend}
            onPointerCancel={finishBend}
            onLostPointerCapture={finishBend}
            onDoubleClick={(event) => {
              event.stopPropagation();
              data?.onBend(undefined);
            }}
            onKeyDown={(event) => {
              if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
                event.preventDefault();
                data?.onBend({
                  x: x + (event.key === 'ArrowRight' ? 12 : event.key === 'ArrowLeft' ? -12 : 0),
                  y: y + (event.key === 'ArrowDown' ? 12 : event.key === 'ArrowUp' ? -12 : 0),
                });
              }
            }}
          />
        </EdgeLabelRenderer>
      )}
    </>
  );
}
