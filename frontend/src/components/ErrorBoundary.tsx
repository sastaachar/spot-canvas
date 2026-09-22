import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  /** What to show when a child throws while rendering. */
  fallback?: ReactNode;
  /** Identity of the guarded subtree; changing it clears a caught error (e.g. a new plugin). */
  resetKey?: unknown;
  label?: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Contains a render error to its subtree so one broken widget (or region) can't
 * blank the whole homepage. React error boundaries must be class components.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn(`[spot-canvas] contained render error${this.props.label ? ` in ${this.props.label}` : ''}`, error, info);
  }

  override render() {
    if (this.state.error) return this.props.fallback ?? null;
    return this.props.children;
  }
}
