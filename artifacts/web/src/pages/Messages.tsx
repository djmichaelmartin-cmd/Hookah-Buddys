import { Layout } from "@/components/Layout";
import { useState } from "react";
import { useListThreads, useListMessages, useSendMessage, useGetCurrentUser, getListMessagesQueryKey, getListThreadsQueryKey, ApiError } from "@workspace/api-client-react";
import { isCheckoutRequired } from "@/lib/checkoutRequired";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { BuddyPill } from "@/components/BuddyPill";
import { useToast } from "@/hooks/use-toast";

export default function Messages() {
  const queryClient = useQueryClient();
  const { data: threads } = useListThreads();
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null);
  const [messageFilter, setMessageFilter] = useState<"all" | "custom">("all");

  const { data: messages } = useListMessages(activeThreadId || 0, { query: { enabled: !!activeThreadId, queryKey: getListMessagesQueryKey(activeThreadId || 0) } });

  const filteredMessages = messages?.filter(m => messageFilter === "all" || m.customMessage) || [];

  const sendMessage = useSendMessage();
  const [newMessage, setNewMessage] = useState("");
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { data: session } = useGetCurrentUser();
  const myRole = session?.user?.role;
  const isDoll = myRole === "doll";
  const activeThread = threads?.find((t) => t.id === activeThreadId);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeThreadId || !newMessage.trim()) return;

    sendMessage.mutate({
      id: activeThreadId,
      data: { body: newMessage }
    }, {
      onSuccess: () => {
        setNewMessage("");
        queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(activeThreadId) });
        queryClient.invalidateQueries({ queryKey: getListThreadsQueryKey() });
      },
      onError: (err) => {
        const serverMessage =
          err instanceof ApiError &&
          err.data &&
          typeof err.data === "object" &&
          "error" in err.data &&
          typeof (err.data as { error: unknown }).error === "string"
            ? (err.data as { error: string }).error
            : null;
        const checkoutRequired = isCheckoutRequired(err);
        if (checkoutRequired) {
          // No plan/package is known in this context, so send the user to the
          // pricing page where every purchase leads into a valid checkout flow.
          toast({
            title: "Payment required",
            description: serverMessage ?? "Complete a purchase through secure checkout to continue.",
          });
          navigate("/pricing");
          return;
        }
        const outOfCredits = err instanceof ApiError && err.status === 402;
        toast({
          title: outOfCredits ? "Out of credits" : "Message not sent",
          description:
            serverMessage ?? "Something went wrong sending your message. Please try again.",
          variant: "destructive",
          action: outOfCredits ? (
            <Link href="/pricing">
              <Button size="sm" variant="outline">Buy credits</Button>
            </Link>
          ) : undefined,
        });
      },
    });
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 h-[calc(100vh-140px)] flex">
        <div className="w-full max-w-5xl mx-auto bg-card/60 backdrop-blur-md border border-white/10 rounded-2xl flex overflow-hidden shadow-2xl">
          
          {/* Threads List */}
          <div className={`w-full md:w-1/3 border-r border-white/10 flex flex-col ${activeThreadId ? 'hidden md:flex' : 'flex'}`}>
            <div className="p-4 border-b border-white/10 bg-background/30">
              <h2 className="font-serif text-xl text-white">Messages</h2>
            </div>
            <div className="flex-1 overflow-y-auto">
              {threads?.map(thread => (
                <button
                  key={thread.id}
                  onClick={() => setActiveThreadId(thread.id)}
                  className={`w-full text-left p-4 flex items-center gap-3 border-b border-white/5 hover:bg-white/5 transition-colors ${activeThreadId === thread.id ? 'bg-primary/10 border-l-4 border-l-primary' : ''}`}
                >
                  <Avatar>
                    <AvatarImage src={thread.dollPhotoUrl} />
                    <AvatarFallback>{(thread.dollName || thread.memberName || "?").charAt(0)}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <p className="font-medium text-white truncate max-w-[120px]">{thread.dollName || thread.memberName}</p>
                      <BuddyPill buddyType={thread.dollBuddyType || thread.memberBuddyType} className="scale-[0.8] origin-left" />
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{thread.lastMessage || "No messages yet"}</p>
                  </div>
                </button>
              ))}
              {(!threads || threads.length === 0) && (
                <div className="p-8 text-center text-muted-foreground">No conversations yet.</div>
              )}
            </div>
          </div>

          {/* Active Thread */}
          <div className={`flex-1 flex flex-col ${!activeThreadId ? 'hidden md:flex' : 'flex'}`}>
            {activeThreadId ? (
              <>
                <div className="p-4 border-b border-white/10 bg-background/30 flex items-center">
                  <Button variant="ghost" size="sm" className="md:hidden mr-2 text-muted-foreground" onClick={() => setActiveThreadId(null)}>
                    &larr; Back
                  </Button>
                  {isDoll && activeThread?.memberId ? (
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/members/${activeThread.memberId}`}
                        className="font-medium text-white hover:text-primary transition-colors underline-offset-4 hover:underline"
                      >
                        {activeThread.memberName || "View member profile"}
                      </Link>
                      <BuddyPill buddyType={activeThread?.memberBuddyType} />
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-white">
                        {activeThread?.dollName || activeThread?.memberName || "Conversation"}
                      </h3>
                      <BuddyPill buddyType={activeThread?.dollBuddyType || activeThread?.memberBuddyType} />
                    </div>
                  )}
                </div>

                <div className="bg-background/20 border-b border-white/5 px-4 py-2 flex gap-2">
                  <Button size="sm" variant={messageFilter === "all" ? "default" : "outline"} onClick={() => setMessageFilter("all")} className={`h-8 ${messageFilter !== "all" ? 'border-white/10' : ''}`}>All</Button>
                  <Button size="sm" variant={messageFilter === "custom" ? "default" : "outline"} onClick={() => setMessageFilter("custom")} className={`h-8 ${messageFilter !== "custom" ? 'border-white/10' : ''}`}>Custom Content</Button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {filteredMessages.map(msg => {
                    const isMine = msg.senderRole === myRole;
                    return (
                      <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[85%] sm:max-w-[75%] rounded-2xl p-3 ${isMine ? 'bg-primary text-primary-foreground' : 'bg-white/10 text-white'}`}>
                          {msg.customMessage && (
                            <div className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider mb-2 ${isMine ? 'text-primary-foreground/80' : 'text-primary'}`}>
                              Custom Content Delivery
                            </div>
                          )}
                          {(msg.imageUrl || msg.videoUrl) && (
                            <div className="mb-3 rounded-lg overflow-hidden border border-white/10 bg-black max-w-sm">
                              {msg.imageUrl && (
                                <img src={msg.imageUrl} alt="Custom content" className="w-full h-auto object-cover max-h-64" />
                              )}
                              {msg.videoUrl && (
                                <video src={msg.videoUrl} controls className="w-full h-auto object-cover max-h-64" />
                              )}
                            </div>
                          )}
                          <div className="whitespace-pre-wrap">{msg.body}</div>
                        </div>
                      </div>
                    );
                  })}
                  {filteredMessages.length === 0 && (
                    <div className="h-full flex items-center justify-center text-muted-foreground text-center">
                      {messageFilter === "custom" ? "No custom content deliveries in this conversation." : "Say hello!"}
                    </div>
                  )}
                </div>

                <div className="p-4 border-t border-white/10 bg-background/30">
                  <form onSubmit={handleSend} className="flex gap-2">
                    <Input 
                      value={newMessage} 
                      onChange={e => setNewMessage(e.target.value)}
                      placeholder="Type a message..." 
                      className="bg-black/20 border-white/10"
                    />
                    <Button type="submit" disabled={!newMessage.trim() || sendMessage.isPending} className="bg-primary hover:bg-primary/90">Send</Button>
                  </form>
                </div>
              </>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground p-8 text-center">
                Select a conversation to start messaging.
              </div>
            )}
          </div>

        </div>
      </div>
    </Layout>
  );
}
