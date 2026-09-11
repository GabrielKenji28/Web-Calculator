import type { CalculateClient } from './api/client';
import { Calculator } from './components/Calculator';

interface AppProps {
  readonly client: CalculateClient;
}

export function App({ client }: AppProps): React.JSX.Element {
  return (
    <div className="page">
      <header className="brand">
        <p className="brand__identity">
          {/* Decorative: the wordmark beside it already names the brand. */}
          <span className="brand__tile">
            <img className="brand__icon" src="/sezzle-icon.png" alt="" />
          </span>
          <span className="brand__wordmark">Sezzle</span>
        </p>
        <div className="brand__meta">
          <h1 className="brand__label">Calculator</h1>
        </div>
      </header>

      <main className="page__main">
        <Calculator client={client} />
      </main>

      <p className="page__footer">Interest-free math, every time.</p>
    </div>
  );
}
