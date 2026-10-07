export default function FieldGuideArt() {
  return <svg className="field-guide-art" viewBox="0 0 360 240" fill="none" role="presentation" aria-hidden="true">
    <path className="art-paper" d="M28 43 112 24 193 44 269 25 332 45v158l-63-19-76 20-81-20-84 20V43Z" />
    <path className="art-fold" d="m112 24 1 160m80-140v160m76-179v159" />
    <path className="art-route" d="M67 146c24-46 68-71 102-49 18 12 26 41 56 35 30-6 36-57 72-69" />
    <path className="art-route-soft" d="M60 77c19-25 53-30 77-11m63 107c38-15 61-7 91 10" />
    <circle className="art-node art-node-one" cx="68" cy="145" r="15" />
    <circle className="art-node art-node-two" cx="173" cy="100" r="19" />
    <circle className="art-node art-node-three" cx="297" cy="63" r="15" />
    <path className="art-star" d="m258 70 5 12 12 5-12 5-5 12-5-12-12-5 12-5 5-12Z" />
    <circle className="art-compass" cx="73" cy="74" r="20" />
    <path className="art-compass-needle" d="m73 59 5 15-5 15-5-15 5-15Z" />
  </svg>;
}
