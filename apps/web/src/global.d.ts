export interface SpotCanvasHostBridge {
  kind: 'desktop';
  layout: {
    read(): Promise<string | null>;
    write(json: string): Promise<void>;
  };
}

declare global {
  interface Window {
    spotCanvasHost?: SpotCanvasHostBridge;
  }
}
