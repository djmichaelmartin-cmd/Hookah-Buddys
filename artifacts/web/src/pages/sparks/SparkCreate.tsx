import React, { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { Layout } from "@/components/Layout";
import { 
  useUploadSparkVideo, 
  useCreateReel, 
  getListReelsQueryKey, 
  useListTaggableReelUsers,
  useListEditableReelBusinesses,
  getListTaggableReelUsersQueryKey,
  getListEditableReelBusinessesQueryKey,
  type ReelInput 
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Camera, SwitchCamera, UploadCloud, X, Zap, Loader2, Circle, Square, Check, ChevronsUpDown, Info } from "lucide-react";
import { cn } from "@/lib/utils";

export default function SparkCreate() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  useEffect(() => {
    document.title = "Create Spark | HookahBuddys";
  }, []);
  
  const [stage, setStage] = useState<"capture" | "details">("capture");
  const [file, setFile] = useState<File | Blob | null>(null);
  const [fileMeta, setFileMeta] = useState({ name: "", size: 0, duration: 0 });
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  
  // Media Recorder state
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [cameraFacing, setCameraFacing] = useState<"user" | "environment">("user");
  const [isSwitchingCamera, setIsSwitchingCamera] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const timerRef = useRef<number | null>(null);

  // Form state
  const [caption, setCaption] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [category, setCategory] = useState("lounge_night");
  const [visibility, setVisibility] = useState("public");
  const [commentsEnabled, setCommentsEnabled] = useState(true);
  const [sharingEnabled, setSharingEnabled] = useState(true);
  const [location, setLocationInput] = useState("");
  const [feeling, setFeeling] = useState("");

  const [userSearch, setUserSearch] = useState("");
  const [debouncedUserSearch, setDebouncedUserSearch] = useState("");
  
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedUserSearch(userSearch), 300);
    return () => clearTimeout(timer);
  }, [userSearch]);

  const { data: users } = useListTaggableReelUsers(
    { search: debouncedUserSearch || undefined },
    { query: { queryKey: getListTaggableReelUsersQueryKey({ search: debouncedUserSearch || undefined }) } }
  );
  
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);
  // We need to keep a record of selected users' names to display them
  // even if they don't appear in the current search results.
  const [selectedUsersData, setSelectedUsersData] = useState<Array<{ id: number, name: string }>>([]);
  const [userComboboxOpen, setUserComboboxOpen] = useState(false);

  const [businessSearch, setBusinessSearch] = useState("");
  const [debouncedBusinessSearch, setDebouncedBusinessSearch] = useState("");
  
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedBusinessSearch(businessSearch), 300);
    return () => clearTimeout(timer);
  }, [businessSearch]);

  const { data: businesses } = useListEditableReelBusinesses(
    { search: debouncedBusinessSearch || undefined },
    { query: { queryKey: getListEditableReelBusinessesQueryKey({ search: debouncedBusinessSearch || undefined }) } }
  );
  
  const [selectedBusinessId, setSelectedBusinessId] = useState<number | null>(null);
  const [selectedBusinessName, setSelectedBusinessName] = useState<string>("");
  const [businessComboboxOpen, setBusinessComboboxOpen] = useState(false);

  const updateStream = useCallback((nextStream: MediaStream | null) => {
    streamRef.current = nextStream;
    setStream(nextStream);
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      setStream(null);
    }
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;

    video.srcObject = stream;
    video.muted = true;
    void video.play().catch(() => {
      // The live stream remains attached so the browser can start playback
      // as soon as its autoplay policy allows it.
    });

    return () => {
      if (video.srcObject === stream) {
        video.srcObject = null;
      }
    };
  }, [stream]);

  const clearTimers = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      mediaRecorderRef.current = null;
      stopCamera();
      clearTimers();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [stopCamera, clearTimers, previewUrl]);

  const requestCamera = async (facingMode: "user" | "environment") => {
    return navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facingMode } },
      audio: true,
    });
  };

  const startCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast({ title: "Unsupported Browser", description: "Your browser does not support camera access.", variant: "destructive" });
      return;
    }
    
    try {
      const ms = await requestCamera(cameraFacing);
      updateStream(ms);
    } catch (e: any) {
      if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError") {
        toast({ title: "Permission Denied", description: "Please allow camera and microphone access to record.", variant: "destructive" });
      } else {
        toast({ title: "Camera Error", description: "Unable to access camera or microphone. Your device might not support it.", variant: "destructive" });
      }
    }
  };

  const switchCamera = async () => {
    if (!stream || isRecording || isSwitchingCamera) return;

    const nextFacing = cameraFacing === "user" ? "environment" : "user";
    const previousStream = stream;
    setIsSwitchingCamera(true);

    try {
      previousStream.getTracks().forEach(track => track.stop());
      const nextStream = await requestCamera(nextFacing);
      setCameraFacing(nextFacing);
      updateStream(nextStream);
    } catch {
      try {
        const restoredStream = await requestCamera(cameraFacing);
        updateStream(restoredStream);
      } catch {
        updateStream(null);
      }
      toast({
        title: "Camera Unavailable",
        description: nextFacing === "environment"
          ? "A rear camera could not be opened on this device."
          : "The front camera could not be opened on this device.",
        variant: "destructive",
      });
    } finally {
      setIsSwitchingCamera(false);
    }
  };

  const startRecording = () => {
    if (!stream) return;
    if (typeof window === "undefined" || !window.MediaRecorder) {
      toast({ title: "Unsupported Browser", description: "Your browser does not support video recording.", variant: "destructive" });
      return;
    }

    const chunks: Blob[] = [];
    const mimeTypes = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"];
    let mimeType = "";
    
    for (const t of mimeTypes) {
      if (typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported(t)) {
        mimeType = t;
        break;
      }
    }
    
    if (!mimeType) {
      toast({ title: "Unsupported Browser", description: "Your browser does not support native video recording. Please upload a file instead.", variant: "destructive" });
      return;
    }
    
    try {
      const recorder = new MediaRecorder(stream, { mimeType });
      recorder.ondataavailable = e => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      
      recorder.onstop = () => {
        if (!isMountedRef.current) return;
        const blob = new Blob(chunks, { type: mimeType });
        (blob as any).name = `recorded-spark-${Date.now()}.${mimeType.includes("mp4") ? "mp4" : "webm"}`;
        validateAndSetFile(blob);
      };
      
      recorder.start(1000);
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordingDuration(0);
      
      timerRef.current = window.setInterval(() => {
        setRecordingDuration(prev => {
          if (prev >= 89) {
            stopRecording();
            return 90;
          }
          return prev + 1;
        });
      }, 1000);
    } catch (e) {
      toast({ title: "Recording Failed", description: "Could not start the video recorder.", variant: "destructive" });
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    clearTimers();
    stopCamera();
  };

  const validateAndSetFile = (f: Blob | File) => {
    const filename = (f as File).name || "recorded-video.webm";
    const mediaType = f.type.split(";")[0].toLowerCase();
    const extension = filename.split(".").pop()?.toLowerCase();
    const allowedType =
      ["video/mp4", "video/quicktime", "video/webm"].includes(mediaType) ||
      ["mp4", "mov", "webm"].includes(extension ?? "");
    if (!allowedType) {
      toast({ title: "Unsupported format", description: "Please upload an MP4, MOV, or WebM video.", variant: "destructive" });
      return;
    }
    if (f.size > 50 * 1024 * 1024) {
      toast({ title: "File too large", description: "Sparks must be under 50MB.", variant: "destructive" });
      return;
    }
    const url = URL.createObjectURL(f);
    const video = document.createElement("video");
    const selectFile = (duration: number) => {
      setFile(f);
      setFileMeta({ name: filename, size: f.size, duration });
      setPreviewUrl(url);
      setStage("details");
    };
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      if (!isMountedRef.current) {
        URL.revokeObjectURL(url);
        return;
      }
      if (Number.isFinite(video.duration) && video.duration > 90.5) {
        toast({ title: "Video too long", description: "Sparks must be under 90 seconds.", variant: "destructive" });
        URL.revokeObjectURL(url);
      } else {
        selectFile(Number.isFinite(video.duration) ? video.duration : 0);
      }
    };
    video.onerror = () => {
      if (!isMountedRef.current) {
        URL.revokeObjectURL(url);
        return;
      }
      // Some browsers cannot decode every valid MP4/MOV codec. Let the
      // protected server pipeline sniff the bytes and enforce the 90s limit.
      selectFile(0);
    };
    video.src = url;
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      validateAndSetFile(e.target.files[0]);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files?.[0]) {
      validateAndSetFile(e.dataTransfer.files[0]);
    }
  };

  const reset = () => {
    setFile(null);
    setFileMeta({ name: "", size: 0, duration: 0 });
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setStage("capture");
  };

  const uploadSpark = useUploadSparkVideo();
  const createSpark = useCreateReel();

  const isUploading = uploadSpark.isPending || createSpark.isPending;

  const handleSubmit = async () => {
    if (!file) return;
    try {
      const uploadRes = await uploadSpark.mutateAsync({ data: file });
      
      const input: ReelInput = {
        videoUrl: uploadRes.objectPath,
        thumbnailUrl: uploadRes.posterPath,
        caption: caption.trim() || undefined,
        category: category as any,
        hashtags: hashtags.split(/[\s,]+/).filter(t => t.trim().length > 0),
        peopleTags: selectedUserIds.length > 0 ? selectedUserIds : undefined,
        businessId: selectedBusinessId || undefined,
        location: location.trim() || undefined,
        feeling: feeling.trim() || undefined,
        visibility: visibility as any,
        commentsEnabled,
        sharingEnabled
      };

      await createSpark.mutateAsync({ data: input });
      queryClient.invalidateQueries({ queryKey: getListReelsQueryKey({}) });
      toast({ title: "Spark ignited!", description: "Your Spark is now live." });
      setLocation("/sparks");
    } catch (e: any) {
      const msg = e?.message || e?.error || "There was a problem publishing your Spark.";
      toast({ title: "Upload Failed", description: msg, variant: "destructive" });
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <div className="mb-8">
          <h1 className="text-4xl font-serif text-white font-bold flex items-center gap-3">
            <Zap className="w-8 h-8 text-primary fill-primary" /> Create a Spark
          </h1>
          <p className="text-muted-foreground mt-2 text-lg">
            Share your best moments with the HookahBuddys community.
          </p>
        </div>

        {stage === "capture" ? (
          <div className="bg-card border border-white/5 rounded-3xl overflow-hidden flex flex-col md:flex-row shadow-2xl relative min-h-[60vh]">
            <div className="flex-1 flex flex-col items-center justify-center p-8 bg-black relative">
              {stream ? (
                <>
                  <video
                    ref={videoRef}
                    className={cn(
                      "absolute inset-0 w-full h-full object-cover",
                      cameraFacing === "user" && "scale-x-[-1]"
                    )}
                    autoPlay
                    playsInline
                    muted
                  />
                  <div className="absolute top-6 right-6 bg-black/50 backdrop-blur-md px-4 py-1.5 rounded-full text-white font-mono text-sm font-semibold flex items-center gap-2 border border-white/10 z-10">
                    {isRecording && <span className="w-2 h-2 rounded-full bg-destructive animate-pulse" />}
                    00:{recordingDuration.toString().padStart(2, '0')} / 01:30
                  </div>
                  <div className="absolute bottom-10 left-0 right-0 flex justify-center gap-6 items-center z-10">
                    {isRecording ? (
                      <button
                        onClick={stopRecording}
                        className="w-20 h-20 bg-destructive/20 rounded-full flex items-center justify-center border-4 border-destructive/50 transition-transform active:scale-95 backdrop-blur-md"
                        title="Stop Recording"
                        aria-label="Stop Recording"
                        data-testid="button-stop-recording"
                      >
                        <Square className="w-8 h-8 text-destructive fill-destructive" />
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={stopCamera}
                          className="w-14 h-14 bg-black/40 border border-white/20 rounded-full flex items-center justify-center hover:bg-black/60 transition-colors backdrop-blur-md"
                          title="Close Camera"
                          aria-label="Close Camera"
                          data-testid="button-close-camera"
                        >
                          <X className="w-6 h-6 text-white" />
                        </button>
                        <button
                          onClick={startRecording}
                          className="w-20 h-20 bg-primary/20 rounded-full flex items-center justify-center border-4 border-primary/50 transition-transform active:scale-95 hover:bg-primary/30 backdrop-blur-md"
                          title="Start Recording"
                          aria-label="Start Recording"
                          data-testid="button-start-recording"
                        >
                          <Circle className="w-8 h-8 text-primary fill-primary" />
                        </button>
                        <button
                          onClick={switchCamera}
                          disabled={isSwitchingCamera}
                          className="w-14 h-14 bg-black/40 border border-white/20 rounded-full flex items-center justify-center hover:bg-black/60 transition-colors backdrop-blur-md disabled:opacity-50"
                          title={cameraFacing === "user" ? "Switch to Rear Camera" : "Switch to Front Camera"}
                          aria-label={cameraFacing === "user" ? "Switch to Rear Camera" : "Switch to Front Camera"}
                          data-testid="button-switch-camera"
                        >
                          {isSwitchingCamera
                            ? <Loader2 className="w-6 h-6 text-white animate-spin" />
                            : <SwitchCamera className="w-6 h-6 text-white" />}
                        </button>
                      </>
                    )}
                  </div>
                </>
              ) : (
                <div className="text-center space-y-6">
                  <div className="w-24 h-24 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4 border border-primary/20">
                    <Camera className="w-10 h-10 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-serif text-white mb-2">Record a Spark</h3>
                    <p className="text-muted-foreground max-w-md mx-auto">
                      Use your camera to record up to 90 seconds of video directly in the browser.
                    </p>
                  </div>
                  <Button onClick={startCamera} size="lg" className="rounded-full px-8 bg-white text-black hover:bg-white/90 font-bold" data-testid="button-start-camera">
                    Start Camera
                  </Button>
                </div>
              )}
            </div>
            
            {!stream && (
              <div 
                className={cn(
                  "flex-1 flex flex-col items-center justify-center p-8 border-t md:border-t-0 md:border-l border-white/5 relative group transition-colors",
                  isDragging ? "bg-secondary/20" : "bg-accent/30 hover:bg-accent/40"
                )}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
                onDrop={onDrop}
              >
                <input
                  type="file"
                  accept="video/mp4,video/quicktime,video/webm"
                  onChange={onFileChange}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  title="Upload Video"
                  data-testid="input-upload-spark"
                />
                <div className={cn(
                  "w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-4 border transition-all duration-300",
                  isDragging ? "bg-secondary/30 border-secondary scale-110" : "bg-secondary/10 border-secondary/20 group-hover:bg-secondary/20 group-hover:scale-105"
                )}>
                  <UploadCloud className={cn("w-10 h-10 text-secondary transition-transform", isDragging && "animate-bounce")} />
                </div>
                <div className="text-center">
                  <h3 className="text-2xl font-serif text-white mb-2">{isDragging ? "Drop to Upload" : "Upload a File"}</h3>
                  <p className="text-muted-foreground max-w-sm mx-auto mb-6">
                    Drag and drop or click to select an MP4, MOV, or WebM file (max 50MB & 90s).
                  </p>
                  <Button variant="outline" className="rounded-full px-8 pointer-events-none border-white/10 group-hover:border-white/20 transition-colors font-bold">
                    Select File
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="grid lg:grid-cols-[1fr_400px] gap-8">
            <div className="bg-black rounded-3xl overflow-hidden relative aspect-[9/16] lg:aspect-auto lg:h-[calc(100vh-200px)] border border-white/10 shadow-2xl flex items-center justify-center group">
              {previewUrl && (
                <video
                  src={previewUrl}
                  controls
                  className="w-full h-full object-contain"
                  autoPlay
                  loop
                  muted
                  playsInline
                />
              )}
              <div className="absolute top-6 right-6 bg-black/60 backdrop-blur-md px-4 py-2 rounded-xl border border-white/10 text-white text-xs font-mono space-y-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                <div className="truncate max-w-[200px]" title={fileMeta.name}>{fileMeta.name}</div>
                <div className="text-white/70">{formatSize(fileMeta.size)} &bull; {formatDuration(fileMeta.duration)}</div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={reset}
                className="absolute top-6 left-6 rounded-full bg-black/60 text-white hover:bg-black/80 backdrop-blur-md border border-white/10 font-bold transition-transform active:scale-95 opacity-0 group-hover:opacity-100 z-10"
                title="Discard Spark"
                aria-label="Discard Spark"
                data-testid="button-discard-spark"
              >
                <X className="w-4 h-4 mr-2" /> Discard
              </Button>
            </div>

            <div className="space-y-6">
              <div className="bg-card p-6 rounded-3xl border border-white/5 space-y-6 shadow-xl">
                <div>
                  <Label className="text-white/90 font-semibold text-[15px]">Caption</Label>
                  <Textarea 
                    value={caption}
                    onChange={e => setCaption(e.target.value)}
                    placeholder="Describe your Spark..."
                    className="mt-2 bg-background/50 border-white/10 resize-none rounded-xl focus-visible:ring-primary/50 text-[15px]"
                    rows={3}
                    data-testid="input-caption"
                  />
                </div>

                <div>
                  <Label className="text-white/90 font-semibold text-[15px]">Hashtags</Label>
                  <Input 
                    value={hashtags}
                    onChange={e => setHashtags(e.target.value)}
                    placeholder="lounge, hookah, vibes"
                    className="mt-2 bg-background/50 border-white/10 rounded-xl focus-visible:ring-primary/50 text-[15px]"
                    data-testid="input-hashtags"
                  />
                </div>

                <div>
                  <Label className="text-white/90 font-semibold text-[15px]">Category</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger className="mt-2 bg-background/50 border-white/10 rounded-xl font-medium" data-testid="select-category">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="lounge_night">Lounge Night</SelectItem>
                      <SelectItem value="hookah_setup">Hookah Setup</SelectItem>
                      <SelectItem value="flavor_review">Flavor Review</SelectItem>
                      <SelectItem value="smoke_tricks">Smoke Tricks</SelectItem>
                      <SelectItem value="event">Event</SelectItem>
                      <SelectItem value="meme">Meme</SelectItem>
                      <SelectItem value="doll_spotlight">Buddy Spotlight</SelectItem>
                      <SelectItem value="bro_post">Member Post</SelectItem>
                      <SelectItem value="tutorial">Tutorial</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-white/90 font-semibold text-[15px]">Tag People</Label>
                  <Popover open={userComboboxOpen} onOpenChange={setUserComboboxOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={userComboboxOpen}
                        className="w-full mt-2 justify-between bg-background/50 border-white/10 rounded-xl font-normal text-left h-auto min-h-10 px-3 py-2 text-[15px]"
                      >
                        <span className="truncate flex-1">
                          {selectedUserIds.length > 0 
                            ? `${selectedUserIds.length} person(s) tagged`
                            : "Search users..."}
                        </span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[300px] p-0 bg-card border-white/10">
                      <Command className="bg-transparent">
                        <CommandInput 
                          placeholder="Search people..." 
                          value={userSearch}
                          onValueChange={setUserSearch}
                        />
                        <CommandEmpty>No users found.</CommandEmpty>
                        <CommandGroup className="max-h-60 overflow-y-auto">
                          {selectedUsersData.map(user => (
                            <CommandItem
                              key={`selected-${user.id}`}
                              value={user.name}
                              onSelect={() => {
                                setSelectedUserIds(prev => prev.filter(id => id !== user.id));
                                setSelectedUsersData(prev => prev.filter(u => u.id !== user.id));
                              }}
                            >
                              <Check className="mr-2 h-4 w-4 opacity-100" />
                              {user.name}
                            </CommandItem>
                          ))}
                          
                          {users?.filter(u => !selectedUserIds.includes(u.id)).map(user => {
                            return (
                              <CommandItem
                                key={user.id}
                                value={user.name}
                                onSelect={() => {
                                  setSelectedUserIds(prev => [...prev, user.id]);
                                  setSelectedUsersData(prev => [...prev, { id: user.id, name: user.name }]);
                                }}
                              >
                                <Check className="mr-2 h-4 w-4 opacity-0" />
                                {user.name}
                              </CommandItem>
                            );
                          })}
                        </CommandGroup>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>

                <div>
                  <Label className="text-white/90 font-semibold text-[15px]">Tagged Business</Label>
                  <Popover open={businessComboboxOpen} onOpenChange={setBusinessComboboxOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={businessComboboxOpen}
                        className="w-full mt-2 justify-between bg-background/50 border-white/10 rounded-xl font-normal text-left h-10 px-3 text-[15px]"
                      >
                        <span className="truncate flex-1">
                          {selectedBusinessId 
                            ? selectedBusinessName || (businesses?.find(b => b.id === selectedBusinessId)?.name) || "Selected business"
                            : "Search businesses..."}
                        </span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[300px] p-0 bg-card border-white/10">
                      <Command className="bg-transparent">
                        <CommandInput 
                          placeholder="Search businesses..." 
                          value={businessSearch}
                          onValueChange={setBusinessSearch}
                        />
                        <CommandEmpty>No businesses found.</CommandEmpty>
                        <CommandList>
                          <CommandGroup className="max-h-60 overflow-y-auto">
                            {selectedBusinessId && selectedBusinessName && !businesses?.find(b => b.id === selectedBusinessId) && (
                              <CommandItem
                                key={`selected-${selectedBusinessId}`}
                                value={selectedBusinessName}
                                onSelect={() => {
                                  setSelectedBusinessId(null);
                                  setSelectedBusinessName("");
                                  setBusinessComboboxOpen(false);
                                }}
                              >
                                <Check className="mr-2 h-4 w-4 opacity-100" />
                                {selectedBusinessName}
                              </CommandItem>
                            )}
                            
                            {businesses?.map(bus => (
                              <CommandItem
                                key={bus.id}
                                value={bus.name}
                                onSelect={() => {
                                  if (selectedBusinessId === bus.id) {
                                    setSelectedBusinessId(null);
                                    setSelectedBusinessName("");
                                  } else {
                                    setSelectedBusinessId(bus.id);
                                    setSelectedBusinessName(bus.name);
                                  }
                                  setBusinessComboboxOpen(false);
                                }}
                              >
                                <Check
                                  className={cn(
                                    "mr-2 h-4 w-4",
                                    selectedBusinessId === bus.id ? "opacity-100" : "opacity-0"
                                  )}
                                />
                                {bus.name}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
                
                <div>
                  <Label className="text-white/90 font-semibold text-[15px]">Location</Label>
                  <Input 
                    value={location}
                    onChange={e => setLocationInput(e.target.value)}
                    placeholder="e.g. Las Vegas, NV"
                    className="mt-2 bg-background/50 border-white/10 rounded-xl focus-visible:ring-primary/50 text-[15px]"
                    data-testid="input-location"
                  />
                </div>

                <div>
                  <Label className="text-white/90 font-semibold text-[15px]">Feeling</Label>
                  <Input 
                    value={feeling}
                    onChange={e => setFeeling(e.target.value)}
                    placeholder="e.g. Chill, Energized"
                    className="mt-2 bg-background/50 border-white/10 rounded-xl focus-visible:ring-primary/50 text-[15px]"
                    data-testid="input-feeling"
                  />
                </div>
                
                <div>
                  <Label className="text-white/90 font-semibold text-[15px]">Visibility</Label>
                  <Select value={visibility} onValueChange={setVisibility}>
                    <SelectTrigger className="mt-2 bg-background/50 border-white/10 rounded-xl font-medium" data-testid="select-visibility">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="public">Public (Everyone)</SelectItem>
                      <SelectItem value="friends">Friends / Followers</SelectItem>
                      <SelectItem value="only_me">Only Me</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <Label className="text-white/90 font-semibold cursor-pointer" htmlFor="comments">Allow Comments</Label>
                  <Switch id="comments" checked={commentsEnabled} onCheckedChange={setCommentsEnabled} data-testid="switch-comments" />
                </div>
                
                <div className="flex items-center justify-between pt-2">
                  <Label className="text-white/90 font-semibold cursor-pointer" htmlFor="sharing">Allow Sharing</Label>
                  <Switch id="sharing" checked={sharingEnabled} onCheckedChange={setSharingEnabled} data-testid="switch-sharing" />
                </div>
              </div>

              <div className="space-y-3">
                <Button
                  size="lg"
                  onClick={handleSubmit}
                  disabled={isUploading || !file}
                  className="w-full rounded-2xl bg-primary hover:bg-primary/90 text-primary-foreground font-bold shadow-[0_0_20px_rgba(24,119,242,0.4)] transition-transform active:scale-95 py-6 text-lg"
                  data-testid="button-publish-spark"
                >
                  {isUploading ? (
                    <><Loader2 className="w-6 h-6 mr-3 animate-spin" /> {uploadSpark.isPending ? "Uploading Media..." : "Publishing Spark..."}</>
                  ) : (
                    <><Zap className="w-6 h-6 mr-3 fill-current" /> Publish Spark</>
                  )}
                </Button>
                {isUploading && (
                  <p className="text-center text-sm font-mono text-muted-foreground flex items-center justify-center gap-2">
                    <Info className="w-4 h-4" /> Please don't close this page.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
