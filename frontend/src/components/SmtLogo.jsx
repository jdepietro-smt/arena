// The SMT diamond, the same logo file the Link, Comms and Decoder apps use, shown as shipped: original colours, original proportions
// (set one dimension and let the other follow). Brand rule: keep clear space around it at least as wide as the white diamond at its
// centre, which is about 40% of the logo's width, so callers leave that much room.
import smtLogo from '../assets/smt-logo.png'

export default function SmtLogo({ size = 34, className = '' }) {
  return <img src={smtLogo} alt="SMT" height={size} style={{ height: size, width: 'auto' }} className={`shrink-0 select-none ${className}`} draggable={false} />
}
