export function OwnerSkeletonList({ count = 3 }: { count?: number }) {
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="owner-skel" style={{ width: 44, height: 44, borderRadius: '50%', flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div className="owner-skel" style={{ width: '60%', height: 16, marginBottom: 6 }} />
            <div className="owner-skel" style={{ width: '40%', height: 14 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function OwnerSkeletonCards({ count = 2 }: { count?: number }) {
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="owner-skel" style={{ width: '100%', height: 100, borderRadius: 12 }} />
      ))}
    </div>
  );
}

export function OwnerSkeletonBlocks({ count = 3 }: { count?: number }) {
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="owner-skel" style={{ width: '100%', height: 60, borderRadius: 8 }} />
      ))}
    </div>
  );
}
