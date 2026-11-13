type Props = { title: string; blurb: string; price: string; onBuy: () => void };

export function ProductCard({ title, blurb, price, onBuy }: Props) {
  return (
    <div className="w-72 border border-gray-400 bg-gray-100 p-3 rounded-none">
      <h3 className="text-lg font-bold text-black">{title}</h3>
      <p className="mt-1 text-sm text-gray-700">{blurb}</p>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-base font-bold text-green-700">{price}</span>
        <button onClick={onBuy} className="bg-orange-500 px-3 py-1 text-sm text-white rounded-none">
          Buy
        </button>
      </div>
    </div>
  );
}
