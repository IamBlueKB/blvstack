// BLVSTACK wordmark — React version. Uses Λ (Greek capital Lambda) as the stylized 'A'.
// Screen readers + crawlers see "BLVSTACK" via the sr-only span; the decorative Λ is aria-hidden.

export default function Brand() {
  return (
    <span style={{ whiteSpace: 'nowrap' }}>
      <span className="sr-only">BLVSTACK</span>
      <span aria-hidden="true">BLVSTΛCK</span>
    </span>
  );
}
