export default function Slide16() {
  return (
    <div className="w-screen h-screen overflow-hidden relative deck-frame">
      <p className="eyebrow">Investment opportunity</p>
      <h1 className="deck-title">Opportunity to Help Build the Social Platform for Hookah Culture</h1>
      <div className="deck-content">
        <div className="grid grid-cols-[1fr_1.25fr] gap-[3vw]">
          <div>
            <p className="text-[2.4vw] leading-snug gold">Seeking strategic investors to help fund continued development, launch preparation, and early growth.</p>
            <p className="copy mt-[3vh]">Free social adoption · Premium access · Creator tools · Local business opportunities · Real-world engagement</p>
          </div>
          <div className="panel">
            <div className="small">Founder</div>
            <p className="copy">Earl Halbert &amp; William Jepson</p>
            <div className="small mt-[1vh]">Email</div>
            <a href="mailto:coolshirtsclublv@gmail.com" className="text-[2vw] blue underline">coolshirtsclublv@gmail.com</a>
            <div className="small mt-[1vh]">Phone</div>
            <p className="copy">(702) 328-9219</p>
            <div className="small mt-[1vh]">Website/App</div>
            <a href="https://hookahdolls.replit.app" target="_blank" rel="noopener noreferrer" className="text-[2vw] blue underline">hookahdolls.replit.app</a>
          </div>
        </div>
        <p className="small mt-[3vh]">This presentation is for discussion purposes only and does not constitute an offer to sell securities. Financial projections, if added, should be reviewed with legal and financial advisors.</p>
      </div>
      <footer className="deck-footer"><span>HookahBuddys · Investor Pitch Deck</span><span>16 / 16</span></footer>
    </div>
  );
}