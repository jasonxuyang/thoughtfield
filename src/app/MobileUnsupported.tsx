import { BUY_ME_A_COFFEE_URL, SITE_NAME } from "../site";

export function MobileUnsupported() {
  return (
    <main className="mobile-gate">
      <div className="mobile-gate__stack">
        <a
          className="mobile-gate__pour"
          href={BUY_ME_A_COFFEE_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Buy me a coffee"
        />
        <p className="mobile-gate__body">
          {SITE_NAME} runs local AI models in your browser and isn&apos;t built
          for mobile. Please use a computer.
        </p>
      </div>
    </main>
  );
}
