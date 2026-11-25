import { Component, lazy, Suspense, useState, type ReactNode } from 'react';
import type { CustomerCrmGraphProps } from './CustomerCrmGraph';

// The graph is its own chunk, loaded the first time "Sơ đồ" opens. It draws with the Memory tab's engine and colors;
// the package's Memory graph component is not reused, because it is an editor of the account's knowledge graph (its
// node click opens its own edit panel, and its toolbar adds, links, deletes and exports JSON/PNG files) with no hook
// for the customer card.
const loadGraph = () => import('./CustomerCrmGraph');

interface BoundaryProps {
  children: ReactNode;
  onRetry: () => void;
}

/** A failed chunk load or a render error in the graph shows a retry box; the table and the page stay up. */
export class CrmGraphBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(_error: unknown): { failed: boolean } {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="v2-empty" role="alert">
        <p>Không tải được sơ đồ. Bảng vẫn dùng được bình thường.</p>
        <button
          type="button"
          className="v2-button"
          onClick={() => {
            this.setState({ failed: false });
            this.props.onRetry();
          }}
        >
          Thử lại
        </button>
      </div>
    );
  }
}

/** The lazy graph behind its own error boundary. "Thử lại" starts a fresh load (a failed lazy load stays failed). */
export function CustomerCrmGraphSlot(props: CustomerCrmGraphProps) {
  const [Graph, setGraph] = useState(() => lazy(loadGraph));
  return (
    <CrmGraphBoundary onRetry={() => setGraph(lazy(loadGraph))}>
      <Suspense fallback={<p className="v2-crm__hint" role="status">Đang mở sơ đồ…</p>}>
        <Graph {...props} />
      </Suspense>
    </CrmGraphBoundary>
  );
}
