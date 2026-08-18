/** The blueprint frame's four registration marks. `light` renders the
 *  rgba-white variant used on navy surfaces. Parent needs `.blueprint`. */
export default function Corners({ light = false }: { light?: boolean }) {
  const cls = light ? "corner corner-light" : "corner";
  return (
    <>
      <i className={`${cls} tl`} />
      <i className={`${cls} tr`} />
      <i className={`${cls} bl`} />
      <i className={`${cls} br`} />
    </>
  );
}
