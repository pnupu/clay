const PLANS = [
  { name: "Free", price: "$0", features: ["1 project", "Community support"], popular: false },
  { name: "Team", price: "$12", features: ["Unlimited projects", "Priority support", "SSO"], popular: true },
  { name: "Enterprise", price: "Custom", features: ["Audit log", "SLA", "Dedicated manager"], popular: false },
];

export function PricingTable() {
  return (
    <div className="grid grid-cols-3 gap-1">
      {PLANS.map((p) => (
        <div key={p.name} className="border border-gray-300 p-2 text-gray-800">
          <div className="text-sm">{p.name}{p.popular ? " (popular)" : ""}</div>
          <div className="text-sm">{p.price} / seat / month</div>
          <ul className="mt-1 text-sm">
            {p.features.map((f) => <li key={f}>{f}</li>)}
          </ul>
          <button className="mt-1 border border-gray-400 px-2 text-sm">Choose</button>
        </div>
      ))}
    </div>
  );
}
