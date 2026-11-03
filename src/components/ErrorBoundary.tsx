import { Component, type ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error(error);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="fatal">
          <p className="wordmark">unspoken</p>
          <p>something went quiet for a second. your voicemails are safe on this device.</p>
          <button className="btn btn-gold" onClick={() => (location.href = '/')}>
            take me home
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
