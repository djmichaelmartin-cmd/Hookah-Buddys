import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Video, VideoOff, Mic, MicOff, AlertCircle, PhoneOff, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useParams, useLocation, Link } from "wouter";
import {
  connect,
  type Room,
  type RemoteParticipant,
  type RemoteTrack,
} from "twilio-video";
import { useListVideoChats, useVideoChatToken, ApiError } from "@workspace/api-client-react";

function attachRemoteTrack(track: RemoteTrack, container: HTMLElement, sid: string) {
  if (track.kind === "data") return;
  const el = track.attach();
  el.dataset.sid = sid;
  if (track.kind === "video") {
    el.className = "absolute inset-0 w-full h-full object-cover";
  }
  container.appendChild(el);
}

function VideoRoom({ sessionId }: { sessionId: number }) {
  const [, navigate] = useLocation();
  const tokenMutation = useVideoChatToken();
  const localRef = useRef<HTMLDivElement>(null);
  const remoteRef = useRef<HTMLDivElement>(null);
  const roomRef = useRef<Room | null>(null);
  const [status, setStatus] = useState<"connecting" | "connected" | "error">("connecting");
  const [errorMsg, setErrorMsg] = useState("");
  const [audioOn, setAudioOn] = useState(true);
  const [videoOn, setVideoOn] = useState(true);
  const [remoteCount, setRemoteCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let room: Room | null = null;
    setStatus("connecting");
    setErrorMsg("");
    setRemoteCount(0);
    setAudioOn(true);
    setVideoOn(true);

    const handleParticipant = (participant: RemoteParticipant) => {
      const target = remoteRef.current;
      if (!target) return;
      participant.tracks.forEach((pub) => {
        if (pub.isSubscribed && pub.track) attachRemoteTrack(pub.track, target, participant.sid);
      });
      participant.on("trackSubscribed", (track) => {
        if (remoteRef.current) attachRemoteTrack(track, remoteRef.current, participant.sid);
      });
      participant.on("trackUnsubscribed", (track) => {
        if (track.kind !== "data") track.detach().forEach((el) => el.remove());
      });
      setRemoteCount((c) => c + 1);
    };

    void (async () => {
      try {
        const { token, roomName } = await tokenMutation.mutateAsync({ id: sessionId });
        if (cancelled) return;
        room = await connect(token, { name: roomName, audio: true, video: { width: 640 } });
        if (cancelled) {
          room.disconnect();
          return;
        }
        roomRef.current = room;
        setStatus("connected");

        room.localParticipant.videoTracks.forEach((pub) => {
          if (pub.track && localRef.current) {
            const el = pub.track.attach();
            el.className = "absolute inset-0 w-full h-full object-cover";
            localRef.current.appendChild(el);
          }
        });

        room.participants.forEach(handleParticipant);
        room.on("participantConnected", handleParticipant);
        room.on("participantDisconnected", () => setRemoteCount((c) => Math.max(0, c - 1)));
      } catch (err) {
        if (cancelled) return;
        const msg =
          err instanceof ApiError && err.status === 503
            ? "Video chat isn't configured yet. Please try again later."
            : err instanceof ApiError && err.status === 403
              ? "You're not part of this session."
              : err instanceof ApiError && err.status === 409
                ? "This session has already ended."
                : "Couldn't join the room. Check your camera and microphone permissions.";
        setErrorMsg(msg);
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      if (room) {
        room.localParticipant.tracks.forEach((pub) => {
          const track = pub.track;
          if (track.kind === "audio" || track.kind === "video") {
            track.stop();
            track.detach().forEach((el) => el.remove());
          }
        });
        room.disconnect();
      }
      roomRef.current = null;
      if (remoteRef.current) remoteRef.current.replaceChildren();
      if (localRef.current) localRef.current.replaceChildren();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const toggleAudio = () => {
    const room = roomRef.current;
    if (!room) return;
    room.localParticipant.audioTracks.forEach((pub) => {
      if (audioOn) pub.track.disable();
      else pub.track.enable();
    });
    setAudioOn((v) => !v);
  };

  const toggleVideo = () => {
    const room = roomRef.current;
    if (!room) return;
    room.localParticipant.videoTracks.forEach((pub) => {
      if (videoOn) pub.track.disable();
      else pub.track.enable();
    });
    setVideoOn((v) => !v);
  };

  const endSession = () => {
    roomRef.current?.disconnect();
    navigate("/video-chat");
  };

  return (
    <div className="lg:col-span-2">
      <div className="aspect-video bg-black rounded-2xl border border-white/10 overflow-hidden relative">
        {/* Remote participant (full frame) */}
        <div ref={remoteRef} className="absolute inset-0" />

        {status === "connected" && remoteCount === 0 && (
          <div className="absolute inset-0 z-10 flex items-center justify-center">
            <span className="px-4 py-2 rounded-full bg-black/50 text-white/90 text-sm backdrop-blur-sm">
              Waiting for the other person to join...
            </span>
          </div>
        )}

        {status === "connecting" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
            <Loader2 className="w-10 h-10 animate-spin mb-3 text-primary" />
            Connecting to the lounge...
          </div>
        )}

        {status === "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
            <AlertCircle className="w-10 h-10 text-destructive mb-3" />
            <p className="text-white mb-4">{errorMsg}</p>
            <Button variant="outline" onClick={() => navigate("/video-chat")}>
              Back to sessions
            </Button>
          </div>
        )}

        {/* Local preview: full-frame while alone, picture-in-picture once someone joins */}
        <div
          ref={localRef}
          className={
            remoteCount === 0
              ? "absolute inset-0 z-0"
              : "absolute bottom-24 right-4 w-40 aspect-video bg-black/60 rounded-lg border border-white/20 overflow-hidden z-10"
          }
        />

        {/* Controls */}
        {status === "connected" && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-4 bg-background/80 backdrop-blur-md px-6 py-3 rounded-full border border-white/10 z-20">
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full hover:bg-white/10"
              onClick={toggleAudio}
              title={audioOn ? "Mute" : "Unmute"}
            >
              {audioOn ? <Mic className="w-5 h-5 text-white" /> : <MicOff className="w-5 h-5 text-destructive" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full hover:bg-white/10"
              onClick={toggleVideo}
              title={videoOn ? "Turn camera off" : "Turn camera on"}
            >
              {videoOn ? <Video className="w-5 h-5 text-white" /> : <VideoOff className="w-5 h-5 text-destructive" />}
            </Button>
            <Button variant="destructive" className="rounded-full px-6 font-bold" onClick={endSession}>
              <PhoneOff className="w-4 h-4 mr-2" /> End Session
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function SessionList({ activeId }: { activeId?: number }) {
  const { data: sessions } = useListVideoChats();

  return (
    <div>
      <div className="bg-card/60 backdrop-blur-xl border border-white/10 rounded-2xl p-6 h-full">
        <h3 className="font-serif text-xl text-white mb-6">Sessions</h3>
        {(!sessions || sessions.length === 0) && (
          <p className="text-muted-foreground text-sm italic text-center py-12">No sessions yet.</p>
        )}
        <div className="space-y-3">
          {sessions?.map((s) => {
            const joinable = s.status === "requested" || s.status === "confirmed";
            return (
              <div
                key={s.id}
                className={`p-4 rounded-xl border ${
                  activeId === s.id ? "border-primary bg-primary/10" : "border-white/10 bg-white/5"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-white font-medium truncate">{s.dollName || s.memberName}</p>
                    <p className="text-xs text-muted-foreground capitalize">
                      {s.status}
                      {s.durationMinutes ? ` · ${s.durationMinutes} min` : ""}
                    </p>
                  </div>
                  {joinable && activeId !== s.id && (
                    <Link href={`/video-chat/${s.id}`}>
                      <Button size="sm" className="bg-primary hover:bg-primary/90">
                        Join
                      </Button>
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function VideoChat() {
  const params = useParams();
  const sessionId = params.id ? parseInt(params.id, 10) : null;

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
            <p className="text-primary/80 text-sm">
              A visible smoking hookah MUST be present during all Doll video chat sessions. Failure to comply will
              result in session termination and potential account suspension.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {sessionId ? (
            <VideoRoom sessionId={sessionId} />
          ) : (
            <div className="lg:col-span-2">
              <div className="aspect-video bg-black rounded-2xl border border-white/10 overflow-hidden relative flex flex-col items-center justify-center">
                <Video className="w-16 h-16 text-white/20 mb-4" />
                <p className="text-muted-foreground text-lg">Select a session to join.</p>
              </div>
            </div>
          )}

          <SessionList activeId={sessionId ?? undefined} />
        </div>
      </div>
    </Layout>
  );
}
