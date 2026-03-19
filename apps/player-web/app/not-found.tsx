export default function NotFound() {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "#f4fbff" }}>
      <section style={{ textAlign: "center", maxWidth: 560, padding: 24 }}>
        <p style={{ letterSpacing: "0.18em", textTransform: "uppercase", color: "#9de3ff" }}>Cubica Player Web</p>
        <h1 style={{ fontSize: "clamp(2rem, 6vw, 4rem)", margin: "12px 0" }}>Страница не найдена</h1>
        <p style={{ color: "rgba(244, 251, 255, 0.72)", lineHeight: 1.6 }}>
          Эта навигационная ветка не относится к каноническому Antarctica player scaffold.
        </p>
      </section>
    </main>
  );
}
