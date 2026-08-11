export function GraphLegend() {
  return (
    <div className="view-legend" aria-label="Graph symbol legend">
      <span><i className="legend-symbol symbol-finalist" />Finalist space</span>
      <span><i className="legend-symbol symbol-horizontal" />Horizontal mobility</span>
      <span><i className="legend-symbol symbol-vertical" />Vertical mobility</span>
      <span><i className="legend-symbol symbol-internal" />Internal node</span>
      <span><i className="legend-symbol symbol-door" />Door</span>
      <span><i className="legend-symbol symbol-door-side" />Door-side node</span>
      <span><i className="legend-symbol symbol-exterior" />Exterior access door</span>
      <span><i className="legend-symbol symbol-edge" />Connection</span>
      <span><i className="legend-symbol symbol-vertical-edge" />Vertical connection</span>
      <span><i className="legend-symbol symbol-vehicle-ramp" />Vehicle-only ramp</span>
      <span><i className="legend-symbol symbol-boundary" />IfcSpace boundary</span>
    </div>
  );
}
