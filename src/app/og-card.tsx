// Shared share-link preview frame for Open Graph + Twitter (1200x630).
const INK = '#2d3232';
const GOLD = '#ffc233';

export default function OgCard() {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '56px 64px',
        background: 'linear-gradient(135deg, #241a6e 0%, #5b2ee5 55%, #8b5cf6 100%)',
        fontFamily: 'sans-serif',
      }}
    >
      {/* Trái: chữ */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', maxWidth: 700 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            background: GOLD,
            color: INK,
            fontSize: 30,
            fontWeight: 900,
            padding: '10px 28px',
            borderRadius: 999,
            border: `4px solid ${INK}`,
          }}
        >
          EPIC BATTLE SIMULATOR
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 28 }}>
          <span style={{ color: '#fff', fontSize: 108, fontWeight: 900, lineHeight: 1 }}>MINI BATTLE</span>
          <span style={{ color: GOLD, fontSize: 108, fontWeight: 900, lineHeight: 1 }}>SIMULATOR</span>
        </div>
        <div style={{ color: '#fff', fontSize: 34, marginTop: 24, opacity: 0.95 }}>
          Low-poly army deploy • vs AI, 2 players 1 PC or online
        </div>
        <div style={{ display: 'flex', gap: 16, marginTop: 28 }}>
          {['Vs AI', '2 players 1 PC', 'Online battle'].map((m) => (
            <div
              key={m}
              style={{
                display: 'flex',
                background: 'rgba(255,255,255,0.16)',
                color: '#fff',
                fontSize: 28,
                fontWeight: 700,
                padding: '10px 24px',
                borderRadius: 16,
                border: '3px solid rgba(255,255,255,0.55)',
              }}
            >
              {m}
            </div>
          ))}
        </div>
      </div>

      {/* Phải: logo kiếm chéo */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 300,
            height: 300,
            borderRadius: 72,
            background: 'linear-gradient(180deg, #ffd76a 0%, #f59e0b 100%)',
            border: `8px solid ${INK}`,
          }}
        >
          <span style={{ fontSize: 190 }}>⚔️</span>
        </div>
        <div style={{ color: '#fff', fontSize: 30, fontWeight: 700, marginTop: 20, opacity: 0.9 }}>
          mini-game-01.vercel.app
        </div>
      </div>
    </div>
  );
}
