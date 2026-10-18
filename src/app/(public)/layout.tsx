export const metadata = { robots: { index: false, follow: false } };

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen justify-center bg-slate-50 px-4 py-10">{children}</div>;
}
