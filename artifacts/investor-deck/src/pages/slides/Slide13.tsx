const base = import.meta.env.BASE_URL;
export default function Slide13() {
  return (
    <div className="w-screen h-screen overflow-hidden relative deck-frame">
      <p className="eyebrow">Development status</p>
      <h1 className="deck-title">Platform Development Is Underway</h1>
      <div className="deck-content grid grid-cols-[.85fr_1.15fr] gap-[3vw]">
        <div>
          <p className="text-[2.8vw] font-bold green">Pre-launch / development-stage platform.</p>
          <p className="copy mt-[3vh]">Social profiles, The Lounge, Browse Buddys, Sparks, Groups, Meetups, Business Pages, Events, Credits, Creator tools, and Admin controls.</p>
          <p className="small mt-[3vh]">Architecture and interfaces exist; launch readiness and live payments require validation. No traction claims are presented.</p>
          <p className="small mt-[3vh]">Production app</p>
          <a href="https://hookahdolls.replit.app" target="_blank" rel="noopener noreferrer" className="text-[2vw] blue underline">hookahdolls.replit.app</a>
        </div>
        <div>
          <img src={base + "platform-homepage.png"} crossOrigin="anonymous" alt="HookahBuddys homepage screenshot" className="w-full h-[55vh] object-contain object-top rounded-[.7vw] border border-[#343A46]" />
          <p className="small mt-[2vh]">HookahBuddys homepage · Current development build</p>
        </div>
      </div>
      <footer className="deck-footer"><span>HookahBuddys · Investor Pitch Deck</span><span>13 / 16</span></footer>
    </div>
  );
}