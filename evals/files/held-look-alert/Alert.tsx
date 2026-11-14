type Props = { title: string; children: React.ReactNode; onDismiss?: () => void };

export function ErrorAlert({ title, children, onDismiss }: Props) {
  return (
    <div role="alert" className="flex items-start gap-1 border-4 border-red-700 bg-red-600 p-6 text-white rounded-none shadow-2xl">
      <span className="text-3xl font-black uppercase">!</span>
      <div className="flex-1">
        <p className="text-xl font-black uppercase tracking-widest">{title}</p>
        <div className="mt-1 text-base font-bold">{children}</div>
      </div>
      {onDismiss && <button onClick={onDismiss} className="text-xl font-black">X</button>}
    </div>
  );
}
