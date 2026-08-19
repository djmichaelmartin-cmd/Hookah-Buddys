import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

import NotFound from "@/pages/not-found";
import Home from "@/pages/Home";
import Login from "@/pages/Login";
import SignupDoll from "@/pages/SignupDoll";
import SignupMember from "@/pages/SignupMember";
import ChooseMembership from "@/pages/ChooseMembership";
import Browse from "@/pages/Browse";
import Lounges from "@/pages/Lounges";
import DollProfile from "@/pages/DollProfile";
import MemberProfile from "@/pages/MemberProfile";
import MembersDirectory from "@/pages/MembersDirectory";
import Pricing from "@/pages/Pricing";
import DashboardDoll from "@/pages/DashboardDoll";
import DashboardMember from "@/pages/DashboardMember";
import AdminDashboard from "@/pages/AdminDashboard";
import Upload from "@/pages/Upload";
import Verification from "@/pages/Verification";
import Checkout from "@/pages/Checkout";
import Terms from "@/pages/Terms";
import Privacy from "@/pages/Privacy";
import ContentRules from "@/pages/ContentRules";
import RefundPolicy from "@/pages/RefundPolicy";
import Contact from "@/pages/Contact";
import Messages from "@/pages/Messages";
import VideoChat from "@/pages/VideoChat";
import Feed from "@/pages/Feed";
import Notifications from "@/pages/Notifications";
import BroProfile from "@/pages/BroProfile";
import ProfileEdit from "@/pages/ProfileEdit";
import PrivacySettings from "@/pages/PrivacySettings";
import Friends from "@/pages/Friends";
import Reels from "@/pages/Reels";
import { usePresenceHeartbeatLoop } from "@/hooks/use-presence-heartbeat";
import Events from "@/pages/Events";
import EventDetail from "@/pages/EventDetail";
import CommunityFeed from "@/pages/CommunityFeed";
import BusinessDiscover from "@/pages/BusinessDiscover";
import BusinessCreate from "@/pages/BusinessCreate";
import BusinessProfile from "@/pages/BusinessProfile";
import BusinessDashboard from "@/pages/BusinessDashboard";

const queryClient = new QueryClient();

function PresenceHeartbeat() {
  usePresenceHeartbeatLoop();
  return null;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/login" component={Login} />
      <Route path="/signup/doll" component={SignupDoll} />
      <Route path="/signup/member" component={SignupMember} />
      <Route path="/signup/bro" component={SignupMember} />
      <Route path="/choose-membership" component={ChooseMembership} />
      <Route path="/browse" component={Browse} />
      <Route path="/lounges" component={Lounges} />
      <Route path="/dolls/:id" component={DollProfile} />
      <Route path="/bros/:id" component={BroProfile} />
      <Route path="/members" component={MembersDirectory} />
      <Route path="/members/:id" component={MemberProfile} />
      <Route path="/pricing" component={Pricing} />
      <Route path="/dashboard/doll" component={DashboardDoll} />
      <Route path="/dashboard/member" component={DashboardMember} />
      <Route path="/admin" component={AdminDashboard} />
      <Route path="/upload" component={Upload} />
      <Route path="/verification" component={Verification} />
      <Route path="/checkout" component={Checkout} />
      <Route path="/terms" component={Terms} />
      <Route path="/privacy" component={Privacy} />
      <Route path="/content-rules" component={ContentRules} />
      <Route path="/refund-policy" component={RefundPolicy} />
      <Route path="/contact" component={Contact} />
      <Route path="/messages" component={Messages} />
      <Route path="/video-chat" component={VideoChat} />
      <Route path="/video-chat/:id" component={VideoChat} />
      <Route path="/feed" component={Feed} />
      <Route path="/notifications" component={Notifications} />
      <Route path="/profile/edit" component={ProfileEdit} />
      <Route path="/settings/privacy" component={PrivacySettings} />
      <Route path="/friends" component={Friends} />
      <Route path="/reels" component={Reels} />
      <Route path="/events" component={Events} />
      <Route path="/events/:id" component={EventDetail} />
      
      {/* Community Routes */}
      <Route path="/community/hookah-setups" component={CommunityFeed} />
      <Route path="/community/favorite-flavors" component={CommunityFeed} />
      <Route path="/community/lounge-reviews" component={CommunityFeed} />
      <Route path="/community/smoke-talk" component={CommunityFeed} />
      <Route path="/community/hookah-memes" component={CommunityFeed} />
      <Route path="/community/questions" component={CommunityFeed} />
      <Route path="/community/hookah-events" component={Events} />
      <Route path="/community/local-lounges" component={Lounges} />

      {/* Business Pages */}
      <Route path="/businesses" component={BusinessDiscover} />
      <Route path="/business/create" component={BusinessCreate} />
      <Route path="/business/:handle" component={BusinessProfile} />
      <Route path="/dashboard/business/:handle" component={BusinessDashboard} />

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <PresenceHeartbeat />
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
