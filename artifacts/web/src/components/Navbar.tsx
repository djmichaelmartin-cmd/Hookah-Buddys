import { Link, useLocation } from "wouter";
import { useGetCurrentUser, useLogout } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { LogOut, User as UserIcon, Settings, Heart, Upload, MessageSquare, Video, ShieldCheck, DollarSign } from "lucide-react";

export function Navbar() {
  const [location] = useLocation();
  const { data: session } = useGetCurrentUser();
  const logout = useLogout();

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSuccess: () => {
        window.location.href = "/";
      }
    });
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b border-white/10 bg-background/60 backdrop-blur-md supports-[backdrop-filter]:bg-background/40">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <span className="font-serif text-2xl font-bold tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-primary via-[#F3E5AB] to-rose-400 drop-shadow-[0_0_10px_rgba(212,175,55,0.5)]">
            HookahDolls
          </span>
        </Link>

        <nav className="hidden md:flex items-center gap-6">
          <Link href="/browse" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors">
            Browse Dolls
          </Link>
          <Link href="/pricing" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors">
            Pricing
          </Link>
        </nav>

        <div className="flex items-center gap-4">
          {session?.authenticated && session.user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-10 w-10 rounded-full border border-primary/30 p-0 hover:bg-white/5 transition-all">
                  <Avatar className="h-9 w-9">
                    <AvatarImage src="" alt={session.user.name} />
                    <AvatarFallback className="bg-card text-primary font-serif">{session.user.name.charAt(0).toUpperCase()}</AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56 bg-card/95 backdrop-blur-xl border-white/10 shadow-[0_0_30px_rgba(0,0,0,0.5)] text-foreground" align="end" forceMount>
                <div className="flex items-center justify-start gap-2 p-2">
                  <div className="flex flex-col space-y-1 leading-none">
                    <p className="font-medium text-primary font-serif">{session.user.name}</p>
                    <p className="w-[200px] truncate text-xs text-muted-foreground">
                      {session.user.email}
                    </p>
                  </div>
                </div>
                <DropdownMenuSeparator className="bg-white/10" />
                
                {session.user.role === 'doll' && (
                  <>
                    <DropdownMenuItem asChild className="cursor-pointer hover:bg-white/5 hover:text-primary">
                      <Link href="/dashboard/doll" className="flex items-center w-full">
                        <UserIcon className="mr-2 h-4 w-4" />
                        <span>Doll Dashboard</span>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild className="cursor-pointer hover:bg-white/5 hover:text-primary">
                      <Link href="/upload" className="flex items-center w-full">
                        <Upload className="mr-2 h-4 w-4" />
                        <span>Upload Content</span>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild className="cursor-pointer hover:bg-white/5 hover:text-primary">
                      <Link href="/verification" className="flex items-center w-full">
                        <ShieldCheck className="mr-2 h-4 w-4" />
                        <span>Verification</span>
                      </Link>
                    </DropdownMenuItem>
                  </>
                )}

                {session.user.role === 'member' && (
                  <>
                    <DropdownMenuItem asChild className="cursor-pointer hover:bg-white/5 hover:text-primary">
                      <Link href="/dashboard/member" className="flex items-center w-full">
                        <Settings className="mr-2 h-4 w-4" />
                        <span>Member Dashboard</span>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild className="cursor-pointer hover:bg-white/5 hover:text-primary">
                      <Link href="/dashboard/member" className="flex items-center w-full">
                        <Heart className="mr-2 h-4 w-4" />
                        <span>Favorites</span>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild className="cursor-pointer hover:bg-white/5 hover:text-primary">
                      <Link href="/dashboard/member" className="flex items-center w-full">
                        <DollarSign className="mr-2 h-4 w-4" />
                        <span>Credits & Billing</span>
                      </Link>
                    </DropdownMenuItem>
                  </>
                )}

                {session.user.role === 'admin' && (
                  <DropdownMenuItem asChild className="cursor-pointer hover:bg-white/5 hover:text-primary">
                    <Link href="/admin" className="flex items-center w-full">
                      <ShieldCheck className="mr-2 h-4 w-4" />
                      <span>Admin Dashboard</span>
                    </Link>
                  </DropdownMenuItem>
                )}

                <DropdownMenuItem asChild className="cursor-pointer hover:bg-white/5 hover:text-primary">
                  <Link href="/messages" className="flex items-center w-full">
                    <MessageSquare className="mr-2 h-4 w-4" />
                    <span>Messages</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild className="cursor-pointer hover:bg-white/5 hover:text-primary">
                  <Link href="/video-chat" className="flex items-center w-full">
                    <Video className="mr-2 h-4 w-4" />
                    <span>Video Chats</span>
                  </Link>
                </DropdownMenuItem>

                <DropdownMenuSeparator className="bg-white/10" />
                <DropdownMenuItem onClick={handleLogout} className="cursor-pointer text-destructive focus:bg-destructive/10 focus:text-destructive">
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Log out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <div className="flex items-center gap-2">
              <Link href="/login" className="hidden sm:inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 hover:text-primary h-10 px-4 py-2">
                Log In
              </Link>
              <Link href="/signup/member" className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2 shadow-[0_0_15px_rgba(212,175,55,0.3)]">
                Join Now
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
