import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Video, AlertCircle } from "lucide-react";

export default function VideoChat() {
  return (
    <Layout>
      <div className="container mx-auto px-4 py-12 max-w-5xl">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-serif text-white flex items-center gap-3">
            <Video className="text-primary w-8 h-8" />
            Lounge Video Chat
          </h1>
        </div>

        <div className="bg-primary/10 border border-primary/30 rounded-xl p-4 mb-8 flex gap-4 items-start">
          <AlertCircle className="w-6 h-6 text-primary shrink-0 mt-1" />
          <div>
            <h3 className="text-primary font-bold mb-1">Strict Platform Rule</h3>
            <p className="text-primary/80 text-sm">A visible smoking hookah MUST be present during all Doll video chat sessions. Failure to comply will result in session termination and potential account suspension.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2">
            <div className="aspect-video bg-black rounded-2xl border border-white/10 overflow-hidden relative flex flex-col items-center justify-center">
              <Video className="w-16 h-16 text-white/20 mb-4" />
              <p className="text-muted-foreground text-lg mb-6">Waiting for session to start...</p>
              <div className="bg-white/5 border border-white/10 px-6 py-4 rounded-lg backdrop-blur-sm text-center">
                <p className="text-xs text-muted-foreground uppercase tracking-widest mb-1">Integration Placeholder</p>
                <p className="text-sm text-white">Daily.co / Twilio Video component mounts here</p>
              </div>
              
              {/* Fake controls */}
              <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-4 bg-background/80 backdrop-blur-md px-6 py-3 rounded-full border border-white/10">
                <Button variant="ghost" size="icon" className="rounded-full hover:bg-white/10"><Video className="w-5 h-5 text-white" /></Button>
                <Button variant="destructive" className="rounded-full px-6 font-bold">End Session</Button>
              </div>
            </div>
          </div>
          
          <div>
            <div className="bg-card/60 backdrop-blur-xl border border-white/10 rounded-2xl p-6 h-full">
              <h3 className="font-serif text-xl text-white mb-6">Scheduled Chats</h3>
              <p className="text-muted-foreground text-sm italic text-center py-12">No upcoming sessions.</p>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
