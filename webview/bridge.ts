import type { HostMessage, Operation, Snapshot } from '../src/protocol';

declare global {
  interface Window {
    acquireVsCodeApi?: () => {
      postMessage(message: any): void;
      getState(): any;
      setState(state: any): void;
    };
  }
}
const api = window.acquireVsCodeApi?.();
export const send = (message: any) =>
  api
    ? api.postMessage(message)
    : window.parent.postMessage({ dokurPreview: true, ...message }, '*');
export const readState = () => api?.getState() ?? {};
export const persistState = (state: any) => api?.setState(state);
export function listen(callback: (message: HostMessage) => void) {
  const handler = (event: MessageEvent) => {
    if (event.data && typeof event.data.type === 'string') callback(event.data);
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}
