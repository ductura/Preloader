// Prvi ekran preloadera; isti sadržaj kao stara statična stranica. Logiku u pregledniku ugrađuje `pages/index.tsx` (`src/main.ts`).
import { defaultConfig, type Config } from '../config.ts';
import { clientText, PACKAGE_LABELS, text } from '../text.ts';

type Option = readonly [key: 'view' | 'package', value: string, name: string];

// Gumbi su izvorno dostupni tipkovnicom; `aria-pressed` postavlja klijent.
function Group({ id, label, options }: { id: string; label: string; options: readonly Option[] }) {
  return (
    <div role="group" aria-labelledby={`choice-${id}`}>
      <span id={`choice-${id}`}>{label}</span>
      {options.map(([key, value, name]) => (
        <button key={value} type="button" {...{ [`data-${key}`]: value }} aria-pressed="false">{name}</button>
      ))}
    </div>
  );
}

const Choice = ({ href, label }: { href: string; label: string }) => <li><a href={href}>{label}</a></li>;

export function PreloaderMain({ config = defaultConfig }: { config?: Config }) {
  return (
    <main className="sheet">
      <h1 className="brand">Ductur<span>a</span></h1>
      <p className="lead">{text.lead}</p>
      <p><a id="open-app" className="button" href={config.frontends.web}>{text.openApp}</a></p>
      <p id="countdown" aria-live="polite" hidden></p>
      <p><button id="stay-here" type="button" hidden>{clientText.stay}</button></p>
      <p id="desktop-offer" hidden><a id="desktop-download" href=""></a></p>
      <section id="choice" className="choice" aria-labelledby="choice-title" hidden>
        <h2 id="choice-title">{text.choiceTitle}</h2>
        {config.frontends.mobile === undefined ? null : (
          <Group id="view" label={text.choiceView} options={[['view', 'desktop', text.views.desktop], ['view', 'mobile', text.views.mobile]]} />
        )}
        <Group id="package" label={text.choicePackage} options={[['package', 'windows', PACKAGE_LABELS.windows], ['package', 'macos', PACKAGE_LABELS.macos]]} />
        <p id="choice-status" role="status"></p>
      </section>
      <noscript>
        <p>{text.noscript}</p>
        <ul>
          <Choice href={config.frontends.web} label={text.openApp} />
          <Choice href={config.downloads.windows} label={clientText.download('windows')} />
          <Choice href={config.downloads.macos} label={clientText.download('macos')} />
        </ul>
      </noscript>
    </main>
  );
}
