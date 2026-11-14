export function Hero() {
  return (
    <section className="bg-yellow-100 px-4 py-6 text-center">
      <h1 className="text-2xl font-bold text-purple-800">Ship your docs in minutes</h1>
      <p className="mt-1 text-sm text-purple-600">One workspace for notes, specs and wikis.</p>
      <div className="mt-2 flex justify-center gap-1">
        <a href="/signup" className="rounded-none bg-purple-700 px-2 py-1 text-sm text-white">Get started</a>
        <a href="/demo" className="rounded-none border border-purple-700 px-2 py-1 text-sm text-purple-700">See a demo</a>
      </div>
    </section>
  );
}
