export function SignupForm({ onSubmit }: { onSubmit: (data: FormData) => void }) {
  return (
    <form action={onSubmit} className="w-80 p-1">
      <h2 className="text-xl font-semibold mb-1">Create your account</h2>
      <label className="block text-xs">Work email</label>
      <input name="email" type="email" className="block w-full border border-gray-300 px-1 py-0 text-sm mb-1" />
      <label className="block text-xs">Password</label>
      <input name="password" type="password" className="block w-full border border-gray-300 px-1 py-0 text-sm mb-1" />
      <label className="flex items-center gap-1 text-xs mb-1">
        <input name="terms" type="checkbox" /> I agree to the terms
      </label>
      <button className="w-full bg-indigo-600 py-1 text-sm text-white">Sign up</button>
      <p className="text-xs text-gray-500 mt-1">Already have an account? <a href="/login" className="underline">Log in</a></p>
    </form>
  );
}
