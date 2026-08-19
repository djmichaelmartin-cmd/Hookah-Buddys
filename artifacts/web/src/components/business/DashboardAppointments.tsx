import { useState } from "react";
import { getErrorMessage } from "@/lib/error";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Calendar, CheckCircle2, XCircle, Clock } from "lucide-react";
import {  
  useListBusinessAppointments,
  useUpdateBusinessAppointmentStatus,
  useRescheduleBusinessAppointment,
  getListBusinessAppointmentsQueryKey,
  BusinessAppointmentStatusUpdateStatus
, BusinessDetail, BusinessAppointmentItem } from "@workspace/api-client-react";

import { Input } from "@/components/ui/input";

export function DashboardAppointments({ business }: { business: BusinessDetail }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [reschedulingId, setReschedulingId] = useState<number | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState("");
  
  const { data: appointments, isLoading } = useListBusinessAppointments(business.handle, {
    query: { enabled: !!business.handle, queryKey: getListBusinessAppointmentsQueryKey(business.handle) }
  });

  const updateStatus = useUpdateBusinessAppointmentStatus({
    mutation: {
      onSuccess: () => {
        toast({ title: "Status updated" });
        queryClient.invalidateQueries({ queryKey: getListBusinessAppointmentsQueryKey(business.handle) });
      },
      onError: (err: unknown) => toast({ title: "Failed to update", description: getErrorMessage(err), variant: "destructive" })
    }
  });

  const rescheduleAppt = useRescheduleBusinessAppointment({
    mutation: {
      onSuccess: () => {
        toast({ title: "Appointment rescheduled" });
        queryClient.invalidateQueries({ queryKey: getListBusinessAppointmentsQueryKey(business.handle) });
      },
      onError: (err: unknown) => toast({ title: "Failed to reschedule", description: getErrorMessage(err), variant: "destructive" })
    }
  });

  const handleStatus = (appointmentId: number, status: BusinessAppointmentStatusUpdateStatus) => {
    updateStatus.mutate({ handle: business.handle, appointmentId, data: { status } });
  };

  const handleReschedule = (appointmentId: number) => {
    if (!rescheduleDate) return;
    const scheduledAt = new Date(rescheduleDate).toISOString();
    rescheduleAppt.mutate({ handle: business.handle, appointmentId, data: { scheduledAt } }, {
      onSuccess: () => setReschedulingId(null)
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'confirmed': return 'text-green-400 bg-green-400/10 border-green-400/20';
      case 'cancelled': return 'text-red-400 bg-red-400/10 border-red-400/20';
      case 'completed': return 'text-blue-400 bg-blue-400/10 border-blue-400/20';
      case 'no_show': return 'text-orange-400 bg-orange-400/10 border-orange-400/20';
      default: return 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-xl font-bold text-white flex items-center gap-2"><Calendar className="w-5 h-5 text-[#D6B56D]" /> Appointments</h3>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-white/50">Loading appointments...</div>
      ) : !appointments || appointments.length === 0 ? (
        <div className="text-center py-12 bg-card/30 border border-white/5 rounded-2xl">
          <Calendar className="w-12 h-12 mx-auto mb-4 text-white/10" />
          <p className="text-white/50">No appointments scheduled.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {appointments.map((apt: BusinessAppointmentItem) => (
            <div key={apt.id} className="bg-card border border-white/10 p-5 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${getStatusColor(apt.status)}`}>
                    {apt.status.replace('_', ' ')}
                  </span>
                  <span className="text-sm font-medium text-white/80 flex items-center gap-1.5"><Clock className="w-3.5 h-3.5"/> {new Date(apt.scheduledAt).toLocaleString()}</span>
                </div>
                <h4 className="font-bold text-white text-lg">{apt.userName || `User #${apt.userId}`}</h4>
                {apt.serviceName && <p className="text-[#D6B56D] text-sm">{apt.serviceName}</p>}
                {apt.notes && <p className="text-sm text-white/60 mt-2 bg-background/50 p-2 rounded-lg border border-white/5">{apt.notes}</p>}
              </div>
              
              <div className="flex flex-col md:items-end gap-2 pt-2 md:pt-0 border-t border-white/10 md:border-0">
                <div className="flex flex-wrap gap-2">
                  {apt.status === 'pending' && (
                    <>
                      <Button size="sm" onClick={() => handleStatus(apt.id, 'confirmed')} className="bg-green-500/20 text-green-400 hover:bg-green-500/30">
                        <CheckCircle2 className="w-4 h-4 mr-1.5" /> Confirm
                      </Button>
                      <Button size="sm" onClick={() => handleStatus(apt.id, 'cancelled')} className="bg-red-500/20 text-red-400 hover:bg-red-500/30">
                        <XCircle className="w-4 h-4 mr-1.5" /> Cancel
                      </Button>
                    </>
                  )}
                  {apt.status === 'confirmed' && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => handleStatus(apt.id, 'completed')} className="border-white/20 text-white">Complete</Button>
                      <Button size="sm" variant="outline" onClick={() => { setReschedulingId(apt.id); setRescheduleDate(""); }} className="border-white/20 text-white">Reschedule</Button>
                      <Button size="sm" variant="outline" onClick={() => handleStatus(apt.id, 'cancelled')} className="border-red-500/20 text-red-400 hover:bg-red-500/10">Cancel</Button>
                    </>
                  )}
                </div>
                
                {reschedulingId === apt.id && (
                  <div className="flex items-center gap-2 mt-2">
                    <Input type="datetime-local" value={rescheduleDate} onChange={e => setRescheduleDate(e.target.value)} className="bg-background h-8 text-xs border-white/10 w-auto" />
                    <Button size="sm" onClick={() => handleReschedule(apt.id)} disabled={!rescheduleDate || rescheduleAppt.isPending} className="bg-[#D6B56D] text-[#111] h-8">Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => setReschedulingId(null)} className="h-8">Cancel</Button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
