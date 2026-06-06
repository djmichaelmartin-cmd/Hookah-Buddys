import { Layout } from "@/components/Layout";
import { useListPlans } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

export default function Pricing() {
  const { data: plans, isLoading } = useListPlans();

  return (
    <Layout>
      <div className="container mx-auto px-4 py-16 text-center">
        <h1 className="text-4xl font-serif text-white mb-4">Memberships & Plans</h1>
        <p className="text-muted-foreground mb-12 max-w-2xl mx-auto">
          Choose your level of access to the exclusive lounge. Premium members get exclusive perks, early access, and free messages.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-5xl mx-auto">
          {isLoading ? (
            <p className="col-span-full text-muted-foreground">Loading plans...</p>
          ) : plans?.map(plan => (
            <div key={plan.id} className={`bg-card/50 backdrop-blur-xl border ${plan.highlighted ? 'border-primary shadow-[0_0_30px_rgba(212,175,55,0.2)]' : 'border-white/10'} rounded-2xl p-8 flex flex-col`}>
              <h3 className="text-2xl font-serif font-bold text-white mb-2">{plan.name}</h3>
              <div className="text-3xl font-bold text-primary mb-4">${plan.price}<span className="text-sm text-muted-foreground font-normal">/{plan.interval}</span></div>
              <p className="text-muted-foreground mb-6 flex-1">{plan.description}</p>
              
              <ul className="space-y-3 mb-8 text-left">
                {plan.features?.map((f, i) => (
                  <li key={i} className="text-sm text-white flex items-start">
                    <span className="text-primary mr-2">✓</span> {f}
                  </li>
                ))}
              </ul>

              <Link href="/checkout" className="w-full mt-auto">
                <Button className={`w-full ${plan.highlighted ? 'bg-primary hover:bg-primary/90 text-primary-foreground' : 'bg-white/10 hover:bg-white/20 text-white'}`}>
                  Select Plan
                </Button>
              </Link>
            </div>
          ))}
        </div>
      </div>
    </Layout>
  );
}
