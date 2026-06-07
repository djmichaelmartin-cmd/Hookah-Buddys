import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

import NotFound from "@/pages/not-found";
import Home from "@/pages/Home";
import Login from "@/pages/Login";
import SignupDoll from "@/pages/SignupDoll";
import SignupMember from "@/pages/SignupMember";
import Browse from "@/pages/Browse";
import Lounges from "@/pages/Lounges";
import DollProfile from "@/pages/DollProfile";
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

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/login" component={Login} />
      <Route path="/signup/doll" component={SignupDoll} />
      <Route path="/signup/member" component={SignupMember} />
      <Route path="/browse" component={Browse} />
      <Route path="/lounges" component={Lounges} />
      <Route path="/dolls/:id" component={DollProfile} />
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
      
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
