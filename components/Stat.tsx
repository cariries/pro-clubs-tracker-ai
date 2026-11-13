export default function Stat({ k, v }: { k: string; v: string | number | null }) {
  return (
    <div className="stat">
      <div className="v">{v === null || v === "" ? "–" : v}</div>
      <div className="k">{k}</div>
    </div>
  );
}
