import type { LiveData } from "@/server/services/websites";
import type { SiteSection } from "@/server/db/schema";
import { publicMediaUrl } from "@/server/storage";

type Page = { path: string; type: string; title: string; navLabel: string; sections: SiteSection[]; position: number; noindex: boolean };
type Theme = { primaryColor: string; accentColor: string; font: string };

const DAY_LABEL: Record<string, string> = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };

function Paragraphs({ text }: { text: unknown }) {
  if (typeof text !== "string" || !text.trim()) return null;
  return (
    <>
      {text.split(/\n{2,}/).map((p, i) => (
        <p key={i} className="mt-3 leading-relaxed text-slate-700">
          {p}
        </p>
      ))}
    </>
  );
}

function href(base: string, path: string) {
  return path === "/" ? `${base}/` : `${base}${path}`;
}

function Section({ s, live, theme, base, preview }: { s: SiteSection; live: LiveData; theme: Theme; base: string; preview: boolean }) {
  const d = s.data as Record<string, unknown>;
  const heading = typeof d.heading === "string" ? d.heading : "";
  const phoneHref = live.business.phone ? `tel:${live.business.phone.replace(/[^\d+]/g, "")}` : null;
  const ctaHref = live.business.appointmentUrl ?? phoneHref ?? href(base, "/contact");
  switch (s.type) {
    case "hero":
      return (
        <section className="px-6 py-20 text-white" style={{ background: theme.primaryColor }}>
          <div className="mx-auto max-w-4xl">
            <h1 className="text-4xl font-bold tracking-tight md:text-5xl">{heading || live.business.name}</h1>
            {typeof d.body === "string" && <p className="mt-4 max-w-2xl text-lg opacity-90">{d.body}</p>}
            <a href={ctaHref} className="mt-8 inline-block rounded-lg px-6 py-3 font-semibold text-slate-900" style={{ background: theme.accentColor }}>
              {String(d.ctaLabel ?? "Contact us")}
            </a>
          </div>
        </section>
      );
    case "text":
    case "service_detail":
      return (
        <section className="px-6 py-12">
          <div className="mx-auto max-w-3xl">
            {heading && <h2 className="text-2xl font-semibold">{heading}</h2>}
            <Paragraphs text={d.body} />
            {typeof d.imageAssetId === "string" && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={publicMediaUrl(d.imageAssetId, "web")} alt="" className="mt-6 rounded-xl" />
            )}
          </div>
        </section>
      );
    case "services_list":
      return (
        <section className="bg-slate-50 px-6 py-12">
          <div className="mx-auto max-w-5xl">
            <h2 className="text-2xl font-semibold">{heading || "Services"}</h2>
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              {live.services.map((x) => (
                <div key={x.name} className="rounded-xl bg-white p-5 shadow-sm">
                  <h3 className="font-semibold">{x.path ? <a href={href(base, x.path)}>{x.name}</a> : x.name}</h3>
                  {x.description && <p className="mt-2 line-clamp-4 text-sm text-slate-600">{x.description}</p>}
                </div>
              ))}
            </div>
          </div>
        </section>
      );
    case "areas":
      return (
        <section className="px-6 py-12">
          <div className="mx-auto max-w-3xl">
            <h2 className="text-2xl font-semibold">{heading || "Areas we serve"}</h2>
            <Paragraphs text={d.body} />
            {live.business.areas.length > 0 && (
              <ul className="mt-4 flex flex-wrap gap-2">
                {live.business.areas.map((a) => (
                  <li key={a} className="rounded-full bg-slate-100 px-3 py-1 text-sm">
                    {a}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      );
    case "reviews_widget":
      if (!live.reviews.length) return null;
      return (
        <section className="bg-slate-50 px-6 py-12">
          <div className="mx-auto max-w-5xl">
            <h2 className="text-2xl font-semibold">{heading || "What customers say"}</h2>
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              {live.reviews.map((r, i) => (
                <figure key={i} className="rounded-xl bg-white p-5 shadow-sm">
                  <div className="text-amber-500" aria-label={`${r.rating} stars`}>
                    {"★".repeat(r.rating)}
                  </div>
                  <blockquote className="mt-2 line-clamp-6 text-sm text-slate-700">{r.text}</blockquote>
                  <figcaption className="mt-3 text-xs text-slate-500">
                    {r.name ?? "Google reviewer"} · {r.date}
                    {preview && r.isDemo && <span className="ml-1 rounded bg-violet-100 px-1 text-violet-700">demo, hidden when published</span>}
                  </figcaption>
                </figure>
              ))}
            </div>
            <p className="mt-4 text-sm">
              <a href={live.business.reviewPageUrl} className="underline">
                Leave a review on Google
              </a>
            </p>
          </div>
        </section>
      );
    case "gallery":
      if (!live.photos.length) return null;
      return (
        <section className="px-6 py-12">
          <div className="mx-auto max-w-5xl">
            <h2 className="text-2xl font-semibold">{heading || "Our work"}</h2>
            <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
              {live.photos.map((p) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={p.id} src={publicMediaUrl(p.id, "square")} alt={p.alt ?? ""} loading="lazy" className="aspect-square w-full rounded-lg object-cover" />
              ))}
            </div>
          </div>
        </section>
      );
    case "faqs":
      if (!live.faqs.length) return null;
      return (
        <section className="px-6 py-12">
          <div className="mx-auto max-w-3xl">
            <h2 className="text-2xl font-semibold">{heading || "Frequently asked questions"}</h2>
            <div className="mt-6 divide-y divide-slate-200">
              {live.faqs.map((f, i) => (
                <details key={i} className="py-4">
                  <summary className="cursor-pointer font-medium">{f.question}</summary>
                  <p className="mt-2 text-slate-700">{f.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      );
    case "posts_widget":
      if (!live.posts.length) return null;
      return (
        <section className="bg-slate-50 px-6 py-12">
          <div className="mx-auto max-w-5xl">
            <h2 className="text-2xl font-semibold">{heading || "Latest updates"}</h2>
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              {live.posts.map((p, i) => (
                <article key={i} className="rounded-xl bg-white p-5 shadow-sm">
                  <p className="text-xs text-slate-500">{p.date}</p>
                  <p className="mt-2 line-clamp-6 text-sm">{p.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      );
    case "contact":
      return (
        <section className="px-6 py-12">
          <div className="mx-auto grid max-w-4xl gap-8 md:grid-cols-2">
            <div>
              <h2 className="text-2xl font-semibold">{heading || "Contact us"}</h2>
              <Paragraphs text={d.body} />
              <ul className="mt-4 space-y-1">
                {live.business.phone && (
                  <li>
                    Phone: <a href={phoneHref!}>{live.business.phone}</a>
                  </li>
                )}
                {live.business.email && (
                  <li>
                    Email: <a href={`mailto:${live.business.email}`}>{live.business.email}</a>
                  </li>
                )}
                {live.business.address && <li>{live.business.address}</li>}
                {live.business.appointmentUrl && (
                  <li>
                    <a href={live.business.appointmentUrl} className="underline">
                      Book online
                    </a>
                  </li>
                )}
              </ul>
            </div>
            {live.business.hours && (
              <div>
                <h3 className="font-semibold">Hours</h3>
                <table className="mt-2 text-sm">
                  <tbody>
                    {Object.keys(DAY_LABEL).map((k) => {
                      const slots = live.business.hours?.[k];
                      return (
                        <tr key={k}>
                          <td className="pr-6">{DAY_LABEL[k]}</td>
                          <td>{!slots || slots.length === 0 ? "Closed" : slots.map((s) => `${s.open}–${s.close}`).join(", ")}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      );
    case "cta":
      return (
        <section className="px-6 py-16 text-center" style={{ background: `${theme.primaryColor}11` }}>
          <h2 className="text-2xl font-semibold">{heading}</h2>
          {typeof d.body === "string" && <p className="mx-auto mt-2 max-w-xl text-slate-700">{d.body}</p>}
          <a href={ctaHref} className="mt-6 inline-block rounded-lg px-6 py-3 font-semibold text-white" style={{ background: theme.primaryColor }}>
            {String(d.ctaLabel ?? "Get in touch")}
          </a>
        </section>
      );
    default:
      return null;
  }
}

/** Renders one page of a generated website. Used for public sites and the draft preview. */
export function SitePage({ name, theme, pages, page, live, base, preview = false }: { name: string; theme: Theme; pages: Page[]; page: Page; live: LiveData; base: string; preview?: boolean }) {
  const nav = pages.filter((p) => !["privacy", "terms", "service"].includes(p.type)).sort((a, b) => a.position - b.position);
  const legal = pages.filter((p) => ["privacy", "terms"].includes(p.type));
  return (
    <div className="min-h-screen bg-white text-slate-900">
      {preview && <div className="bg-amber-400 px-4 py-1.5 text-center text-xs font-medium">Draft preview. Visitors see the last published version.</div>}
      <header className="border-b border-slate-200">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <a href={href(base, "/")} className="text-lg font-bold" style={{ color: theme.primaryColor }}>
            {name}
          </a>
          <nav className="flex flex-wrap gap-4 text-sm">
            {nav.map((p) => (
              <a key={p.path} href={href(base, p.path)} className={p.path === page.path ? "font-semibold" : "text-slate-600 hover:text-slate-900"}>
                {p.navLabel}
              </a>
            ))}
          </nav>
          {live.business.phone && (
            <a href={`tel:${live.business.phone.replace(/[^\d+]/g, "")}`} className="rounded-lg px-4 py-2 text-sm font-semibold text-white" style={{ background: theme.primaryColor }}>
              {live.business.phone}
            </a>
          )}
        </div>
      </header>
      <main>
        {page.type !== "home" && !page.sections.some((s) => s.type === "hero") && (
          <div className="border-b border-slate-100 bg-slate-50 px-6 py-10">
            <h1 className="mx-auto max-w-3xl text-3xl font-bold">{page.title}</h1>
          </div>
        )}
        {page.sections.map((s) => (
          <Section key={s.id} s={s} live={live} theme={theme} base={base} preview={preview} />
        ))}
      </main>
      <footer className="border-t border-slate-200 px-6 py-8 text-sm text-slate-500">
        <div className="mx-auto flex max-w-5xl flex-wrap justify-between gap-4">
          <span>
            © {new Date().getFullYear()} {name}
            {live.business.address && ` · ${live.business.address}`}
          </span>
          <span className="flex gap-4">
            {legal.map((p) => (
              <a key={p.path} href={href(base, p.path)}>
                {p.navLabel}
              </a>
            ))}
          </span>
        </div>
      </footer>
      {live.schema && !preview && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(live.schema).replace(/</g, "\\u003c") }} />}
    </div>
  );
}
