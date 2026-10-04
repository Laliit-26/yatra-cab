import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Input,
  useAuth,
  Card, CardHeader, CardBody, Button, Badge, StatusBadge, Modal, Avatar, StarRating, StarPicker,
  Field, Textarea, QueryBoundary, LoadingScreen, EmptyState, toast,
  inr, formatDateTime, timeUntil, vehicleLabel, VehicleIcon, RIDE_STATUS_META,
} from '@yatracab/ui';
import {
  ArrowLeft, MapPin, Car, CalendarClock, Users, Phone, IndianRupee, Gavel, Star,
  ShieldCheck, Navigation, XCircle, CheckCircle2, Info, Loader2, Sparkles, ShieldAlert, Share2, Ticket,
} from 'lucide-react';
import { api } from '../api.js';
import { getSocket } from '../socket.js';
import { LiveMap } from '../components/LiveMap.jsx';
import { openCheckout } from '../lib/razorpay.js';

export default function RideDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [driverLoc, setDriverLoc] = useState(null);
  const [otp, setOtp] = useState(null); // { phase, code } — pushed when the driver asks

  const rideQuery = useQuery({ queryKey: ['ride', id], queryFn: () => api.get(`/customer/rides/${id}`).then((r) => r.ride) });
  const ride = rideQuery.data;
  const isBidding = ride?.mode === 'bidding' && ride?.status === 'searching';

  const bidsQuery = useQuery({
    queryKey: ['ride-bids', id],
    queryFn: () => api.get(`/customer/rides/${id}/bids`),
    enabled: !!isBidding,
    refetchInterval: isBidding ? 4000 : false,
  });

  // Live updates over socket.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    socket.emit('ride:join', id);
    const onBid = () => qc.invalidateQueries({ queryKey: ['ride-bids', id] });
    const onUpdate = () => { qc.invalidateQueries({ queryKey: ['ride', id] }); qc.invalidateQueries({ queryKey: ['ride-bids', id] }); };
    const onLoc = (p) => p.rideId === id && setDriverLoc({ lat: p.lat, lng: p.lng, heading: p.heading, at: p.at });
    const onOtp = (p) => p.rideId === id && setOtp({ phase: p.phase, code: p.code });
    socket.on('ride:bid_new', onBid);
    socket.on('ride:updated', onUpdate);
    socket.on('ride:started', onUpdate);
    socket.on('ride:driver_location', onLoc);
    socket.on('ride:otp', onOtp);
    return () => {
      socket.emit('ride:leave', id);
      socket.off('ride:bid_new', onBid);
      socket.off('ride:updated', onUpdate);
      socket.off('ride:started', onUpdate);
      socket.off('ride:driver_location', onLoc);
      socket.off('ride:otp', onOtp);
    };
  }, [id, qc]);

  const refetchAll = () => { rideQuery.refetch(); bidsQuery.refetch?.(); };

  return (
    <div className="space-y-5 animate-fade-in">
      <button onClick={() => navigate('/rides')} className="flex items-center gap-1 text-sm text-ink-500 hover:text-ink-700">
        <ArrowLeft size={16} /> All rides
      </button>

      <QueryBoundary query={rideQuery} loading={<LoadingScreen label="Loading ride…" />}>
        {(ride) => (
          <>
            {/* Header */}
            <Card>
              <CardBody>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h1 className="text-xl font-semibold text-ink-900">{ride.destination || ride.route?.destination}</h1>
                      <StatusBadge meta={RIDE_STATUS_META[ride.status]} />
                    </div>
                    <p className="mt-1 text-sm text-ink-500">from {ride.route?.origin || 'Jaipur'} · {ride.route?.templeName}</p>
                  </div>
                  <Badge tone={ride.mode === 'bidding' ? 'info' : 'accent'}>{ride.mode === 'bidding' ? 'Ride Alert' : 'Fixed fare'}</Badge>
                </div>
                {/* Pickup → drop route */}
                <div className="mt-4 rounded-xl border border-ink-100 p-3.5">
                  <div className="flex gap-3">
                    <div className="flex flex-col items-center pt-1.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-accent" />
                      <span className="my-1 w-px flex-1 bg-ink-200" />
                      <span className="h-2.5 w-2.5 rounded-full border-2 border-accent" />
                    </div>
                    <div className="flex-1 space-y-3 text-sm">
                      <div>
                        <p className="text-xs text-ink-400">Pickup</p>
                        <p className="font-medium text-ink-800">{ride.pickup?.address || 'To be confirmed'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-ink-400">Drop</p>
                        <p className="font-medium text-ink-800">{ride.destination || ride.dropLocation?.address || '—'}</p>
                      </div>
                    </div>
                    {ride.distanceKm > 0 && (
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-semibold text-accent">{ride.distanceKm} km</p>
                        {ride.estimatedMins > 0 && <p className="text-xs text-ink-400">~{Math.round(ride.estimatedMins / 60) || 1}h {ride.estimatedMins % 60}m</p>}
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Meta icon={Car} label="Vehicle" value={vehicleLabel(ride.vehicleType)} />
                  <Meta icon={CalendarClock} label="When" value={formatDateTime(ride.scheduledAt)} />
                  <Meta icon={Users} label="Passengers" value={ride.passengers} />
                  <Meta icon={Navigation} label="Trip" value={ride.tripType === 'round_trip' ? 'Round trip' : 'One way'} />
                </div>
                {ride.notes && (
                  <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-ink-50 p-3 text-sm text-ink-600">
                    <Info size={14} className="mt-0.5 shrink-0" /> {ride.notes}
                  </p>
                )}
              </CardBody>
            </Card>

            {/* Celebration moment when the driver is locked in */}
            {ride.status === 'confirmed' && <ConfirmedBanner />}

            {/* State-specific panels */}
            {ride.status === 'pending_payment' && <PaymentPanel ride={ride} onDone={refetchAll} />}
            {/* TESTING — quoted rides confirm without an online payment, so this
                optional card is the only way to reach the gateway. Remove once
                the payment model is settled. */}
            {ride.status === 'confirmed' && <PaymentPanel ride={ride} optional onDone={refetchAll} />}
            {isBidding && <BidsPanel rideId={id} bidsQuery={bidsQuery} onAccepted={refetchAll} />}
            {['confirmed', 'ongoing'].includes(ride.status) && <ActivePanel ride={ride} driverLoc={driverLoc} otp={otp} onChange={refetchAll} />}
            {ride.status === 'completed' && <CompletedPanel ride={ride} onRated={refetchAll} />}
            {['cancelled', 'no_show'].includes(ride.status) && <CancelledPanel ride={ride} />}
          </>
        )}
      </QueryBoundary>
    </div>
  );
}

function Meta({ icon: Icon, label, value }) {
  return (
    <div className="rounded-xl bg-ink-50 p-3">
      <p className="flex items-center gap-1 text-xs text-ink-400"><Icon size={12} /> {label}</p>
      <p className="mt-0.5 text-sm font-medium text-ink-800">{value}</p>
    </div>
  );
}

function MoneyRow({ label, value, hint, bold }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className={`text-sm ${bold ? 'font-semibold text-ink-900' : 'text-ink-600'}`}>
        {label}{hint && <span className="ml-1 text-xs text-ink-400">· {hint}</span>}
      </span>
      <span className={bold ? 'text-lg font-semibold text-accent' : 'text-sm font-medium text-ink-800'}>{value}</span>
    </div>
  );
}

function PaymentPanel({ ride, optional = false, onDone }) {
  const { user, refreshMe } = useAuth();
  const [open, setOpen] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [usePoints, setUsePoints] = useState(false);
  const [couponInput, setCouponInput] = useState('');
  const [coupon, setCoupon] = useState(null); // { code, discount, description }
  const [couponError, setCouponError] = useState('');
  const [checking, setChecking] = useState(false);
  const [applied, setApplied] = useState(null); // { feeAmount, discount, pointsRedeemed }

  // Read the points balance from the referral endpoint (auth user may not carry it).
  const refQuery = useQuery({ queryKey: ['referral'], queryFn: () => api.get('/customer/referral') });
  // Riders should not have to already know a code — show what is running.
  const offersQuery = useQuery({ queryKey: ['coupons'], queryFn: () => api.get('/customer/coupons').then((r) => r.coupons) });
  const points = refQuery.data?.points ?? user?.points ?? 0;

  // Checked before paying, so the rider sees the saving without the code being
  // taken from stock — it is only claimed when they actually pay.
  const applyCoupon = async (fromOffer) => {
    const code = (fromOffer || couponInput).toUpperCase().trim();
    if (!code) return;
    setChecking(true);
    setCouponError('');
    try {
      const res = await api.post(`/customer/rides/${ride._id}/coupon/check`, { code });
      if (res.valid) {
        setCoupon({ code: res.code, discount: res.discount, description: res.description });
        toast.success(`${res.code} applied — ${inr(res.discount)} off`);
      } else {
        setCoupon(null);
        setCouponError(res.message || 'That code did not work');
      }
    } catch (err) {
      setCouponError(err.message);
    } finally {
      setChecking(false);
    }
  };

  const clearCoupon = () => { setCoupon(null); setCouponInput(''); setCouponError(''); };

  const pay = async () => {
    setProcessing(true);
    try {
      const { order, feeAmount, discount, pointsRedeemed, devPaymentOtp } = await api.post(
        `/customer/rides/${ride._id}/payment/order`,
        { usePoints, ...(coupon ? { couponCode: coupon.code } : {}) }
      );
      setApplied({ feeAmount, discount, pointsRedeemed });

      let verifyBody;
      if (order.provider === 'razorpay') {
        // Real gateway: Checkout returns the signature we verify server-side.
        const res = await openCheckout({
          keyId: order.keyId,
          order,
          description: `Advance for ${ride.destination || 'your ride'}`,
          prefill: { name: user?.name, phone: user?.phone, email: user?.email },
        });
        verifyBody = {
          orderId: res.razorpay_order_id,
          paymentId: res.razorpay_payment_id,
          signature: res.razorpay_signature,
        };
      } else {
        // Mock provider: echo the deterministic token back.
        await new Promise((r) => setTimeout(r, 900));
        verifyBody = { orderId: order.id, paymentId: `pay_mock_${Date.now()}`, signature: order.mockToken };
      }

      await api.post(`/customer/rides/${ride._id}/payment/verify`, { ...verifyBody, otp: devPaymentOtp });
      toast.success(discount > 0 ? `Paid — ${inr(discount)} off with points!` : 'Payment successful — booking confirmed!');
      setOpen(false);
      refreshMe?.().catch(() => {});
      onDone();
    } catch (err) {
      // A rider closing the sheet is not an error worth shouting about. The
      // webhook still confirms anything they did pay for.
      if (!err?.dismissed) toast.error(err.message);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title={optional ? 'Pay an advance (optional)' : 'Complete your booking'}
        subtitle={
          optional
            ? 'Not required — your fare is cash to the driver. Available for testing the payment flow.'
            : 'Pay the advance Booking & Safety Fee to confirm.'
        }
        icon={IndianRupee}
      />
      <CardBody>
        <div className="rounded-xl bg-ink-50 p-4">
          <MoneyRow label="Ride fare" value={inr(ride.fareAmount)} hint="cash to driver" />
          <MoneyRow label={`Booking & Safety Fee (${ride.feePercent}%)`} value={inr(ride.feeAmount)} hint="online now" />
          <div className="my-1 border-t border-ink-200" />
          {coupon && <MoneyRow label={`Coupon ${coupon.code}`} value={`− ${inr(coupon.discount)}`} />}
          <MoneyRow label="Pay online now" value={inr(Math.max(0, ride.feeAmount - (coupon?.discount || 0)))} bold />
        </div>
        {/* Coupon */}
        <div className="mt-3">
          {coupon ? (
            <div className="flex items-center gap-2.5 rounded-xl border border-success/40 bg-success-soft p-3.5">
              <Ticket size={16} className="shrink-0 text-success" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-ink-900">{coupon.code} applied</span>
                <span className="block text-xs text-ink-600">{inr(coupon.discount)} off{coupon.description ? ` · ${coupon.description}` : ''}</span>
              </span>
              <button type="button" onClick={clearCoupon} className="shrink-0 text-xs font-medium text-ink-500 hover:text-ink-900">Remove</button>
            </div>
          ) : (
            <div>
              <div className="flex gap-2">
                <Input
                  value={couponInput}
                  onChange={(e) => { setCouponInput(e.target.value.toUpperCase()); setCouponError(''); }}
                  placeholder="Coupon code"
                  className="flex-1 tracking-widest"
                />
                <Button variant="soft" loading={checking} disabled={!couponInput.trim()} onClick={() => applyCoupon()}>Apply</Button>
              </div>
              {couponError && <p className="mt-1.5 text-xs text-danger">{couponError}</p>}

              {offersQuery.data?.length > 0 && (
                <div className="mt-2.5">
                  <p className="mb-1.5 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-ink-400">
                    <Ticket size={11} /> Offers available
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {offersQuery.data.map((o) => (
                      <button
                        key={o.code}
                        type="button"
                        disabled={checking}
                        onClick={() => { setCouponInput(o.code); applyCoupon(o.code); }}
                        className="rounded-lg border border-dashed border-accent/50 bg-accent-soft px-2.5 py-1.5 text-left transition-colors hover:border-accent disabled:opacity-60"
                        title={o.description || ''}
                      >
                        <span className="block text-xs font-bold tracking-wide text-accent">{o.code}</span>
                        <span className="block text-[11px] text-ink-500">
                          {o.type === 'percent' ? `${o.value}% off` : `${inr(o.value)} off`}
                          {o.minFare > 0 ? ` · over ${inr(o.minFare)}` : ''}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {points > 0 && (
          <button
            type="button"
            onClick={() => setUsePoints((v) => !v)}
            className={`mt-3 flex w-full items-center gap-3 rounded-xl border p-3.5 text-left transition-all ${
              usePoints ? 'border-accent bg-accent-soft' : 'border-ink-200 hover:border-accent/40'
            }`}
          >
            <span className={`flex h-5 w-5 items-center justify-center rounded-md border ${usePoints ? 'border-accent bg-accent text-accent-fg' : 'border-ink-300'}`}>
              {usePoints && <CheckCircle2 size={14} />}
            </span>
            <span className="flex-1">
              <span className="flex items-center gap-1.5 text-sm font-medium text-ink-800"><Sparkles size={14} className="text-accent" /> Use my points</span>
              <span className="text-xs text-ink-500">You have {points} points — up to {inr(Math.min(points, ride.feeAmount))} off</span>
            </span>
          </button>
        )}
        <p className="mt-3 flex items-start gap-1.5 text-xs text-ink-500">
          <ShieldCheck size={14} className="mt-0.5 shrink-0 text-success" />
          Free cancellation up to 6h before the ride (minus ₹50). Driver no-show = full refund.
        </p>
        <Button className="mt-4 w-full" size="lg" icon={IndianRupee} onClick={() => setOpen(true)}>
          Pay {inr(Math.max(0, ride.feeAmount - (coupon?.discount || 0)))} advance
        </Button>
      </CardBody>

      <Modal
        open={open}
        onClose={processing ? undefined : () => setOpen(false)}
        title="YatraCab Secure Pay"
        subtitle="Mock gateway (dev) · UPI / Card"
        size="sm"
      >
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-soft text-accent">
            {processing ? <Loader2 size={30} className="animate-spin" /> : <IndianRupee size={30} />}
          </div>
          {(() => {
            // Mirrors the server: the coupon comes off first, then points cover
            // what is left. If this preview disagrees with that order the rider
            // sees one number here and is charged another.
            const couponOff = coupon?.discount || 0;
            const pointsOff = usePoints ? Math.min(points, Math.max(0, ride.feeAmount - couponOff)) : 0;
            const previewDiscount = couponOff + pointsOff;
            const payable = applied ? applied.feeAmount : Math.max(0, ride.feeAmount - previewDiscount);
            return (
              <>
                <p className="text-3xl font-semibold text-ink-900">{inr(payable)}</p>
                <p className="mt-1 text-sm text-ink-500">Booking &amp; Safety Fee</p>
                {previewDiscount > 0 && (
                  <p className="mt-1 flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-sm font-medium text-success">
                    {couponOff > 0 && (
                      <span className="inline-flex items-center gap-1"><Ticket size={13} /> {inr(couponOff)} off · {coupon.code}</span>
                    )}
                    {pointsOff > 0 && (
                      <span className="inline-flex items-center gap-1"><Sparkles size={13} /> {inr(pointsOff)} off with points</span>
                    )}
                  </p>
                )}
              </>
            );
          })()}
          <Button className="mt-6 w-full" size="lg" loading={processing} onClick={pay}>
            {processing ? 'Processing…' : 'Pay now'}
          </Button>
          <p className="mt-3 text-xs text-ink-400">This is a mock payment for testing. No real charge is made.</p>
        </div>
      </Modal>
    </Card>
  );
}

function BidsPanel({ rideId, bidsQuery, onAccepted }) {
  const accept = useMutation({
    mutationFn: (bidId) => api.post(`/customer/rides/${rideId}/accept-bid/${bidId}`),
    onSuccess: () => { toast.success('Quote accepted! Complete payment to confirm.'); onAccepted(); },
    onError: (err) => toast.error(err.message),
  });

  const data = bidsQuery.data;
  const bids = data?.bids || [];

  return (
    <Card>
      <CardHeader
        title="Driver quotes"
        subtitle={data?.fairRange ? `Usual range ${inr(data.fairRange.min)}–${inr(data.fairRange.max)}` : 'Waiting for drivers to bid…'}
        icon={Gavel}
        action={data?.biddingClosesAt ? <Badge tone="info" dot>{timeUntil(data.biddingClosesAt)}</Badge> : null}
      />
      <CardBody>
        {bidsQuery.isLoading ? (
          <LoadingScreen label="Fetching quotes…" />
        ) : bids.length === 0 ? (
          <EmptyState
            icon={Gavel}
            title="No quotes yet"
            message="Verified drivers on this route are being notified. Quotes usually arrive within minutes."
          />
        ) : (
          <div className="space-y-3">
            {bids.map((b) => (
              <div key={b.id} className="flex items-center gap-3 rounded-xl border border-ink-200 p-3.5 transition-colors hover:border-accent/40">
                <Avatar name={b.driver.name} size={44} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium text-ink-900">{b.driver.name}</p>
                    <StarRating value={b.driver.rating} size={12} />
                  </div>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-ink-500">
                    <span className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2 py-0.5 font-medium text-ink-800">
                      <VehicleIcon type={b.driver.vehicle?.type} size={13} />
                      {vehicleLabel(b.driver.vehicle?.type)}
                    </span>
                    {b.driver.vehicle?.seats ? <span>{b.driver.vehicle.seats} seats</span> : null}
                    <span>· {b.driver.completedRides} rides</span>
                    {b.note ? <span>· {b.note}</span> : null}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-semibold text-ink-900">{inr(b.amount)}</p>
                  <Button size="sm" className="mt-1" loading={accept.isPending && accept.variables === b.id} onClick={() => accept.mutate(b.id)}>
                    Accept
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function DriverCard({ ride }) {
  const d = ride.driver;
  if (!d) return null;
  const call = useMutation({
    mutationFn: () => api.post(`/customer/rides/${ride._id}/call`),
    onSuccess: (res) => toast.success(res.message || `Connecting via ${res.virtualNumber}`),
    onError: (err) => toast.error(err.message),
  });
  return (
    <div className="flex items-center gap-3 rounded-xl bg-accent-soft p-4">
      <Avatar name={d.user?.name} size={48} />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-ink-900">{d.user?.name || 'Your driver'}</p>
        <p className="text-xs text-ink-500">
          {d.vehicle?.make} {d.vehicle?.model} · {d.vehicle?.plateNumber} · {vehicleLabel(d.vehicle?.type)}
        </p>
        <div className="mt-0.5"><StarRating value={d.rating || 5} size={12} /></div>
      </div>
      <Button variant="soft" icon={Phone} loading={call.isPending} onClick={() => call.mutate()}>Call</Button>
    </div>
  );
}

function SafetyRow({ ride }) {
  const [confirmSos, setConfirmSos] = useState(false);
  const [sending, setSending] = useState(false);
  const [sharing, setSharing] = useState(false);

  const getLoc = () =>
    new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 8000 }
      );
    });

  const sendSos = async () => {
    setSending(true);
    try {
      const loc = await getLoc();
      const res = await api.post('/customer/safety/sos', {
        rideId: ride._id,
        lat: loc?.lat,
        lng: loc?.lng,
        note: 'SOS from active ride',
      });
      toast.success(res.message || 'SOS raised. Help has been alerted.');
      setConfirmSos(false);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSending(false);
    }
  };

  const shareTrip = async () => {
    setSharing(true);
    try {
      const { trackPath } = await api.post('/customer/safety/share', { rideId: ride._id });
      const url = `${window.location.origin}${trackPath}`;
      await navigator.clipboard?.writeText(url);
      toast.success('Live tracking link copied — share it with family');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSharing(false);
    }
  };

  return (
    <div className="grid grid-cols-2 gap-3">
      <Button variant="ghost" className="border border-danger/30 bg-danger-soft text-danger hover:bg-danger/10" icon={ShieldAlert} onClick={() => setConfirmSos(true)}>
        SOS
      </Button>
      <Button variant="secondary" icon={Share2} loading={sharing} onClick={shareTrip}>
        Share trip
      </Button>

      <Modal open={confirmSos} onClose={sending ? undefined : () => setConfirmSos(false)} title="Send SOS?" subtitle="Your emergency contact will be alerted." size="sm">
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl bg-danger-soft p-4 text-sm text-danger">
            <ShieldAlert size={18} className="mt-0.5 shrink-0" />
            We'll share your live location with your emergency contact and notify your driver. Only use this in a real emergency.
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" disabled={sending} onClick={() => setConfirmSos(false)}>Cancel</Button>
            <Button className="flex-1 bg-danger text-white hover:bg-danger/90" loading={sending} icon={ShieldAlert} onClick={sendSos}>Send SOS</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/**
 * The driver has asked for a checkpoint code; this is where the rider reads it.
 * Deliberately loud — it is the one thing on screen they need to act on, and
 * for the drop-off code it is also their leverage: withhold it and the ride
 * cannot be closed until the fare is what was agreed.
 */
function OtpCallout({ phase, code }) {
  const starting = phase === 'start';
  return (
    <div className="rounded-xl border border-accent/40 bg-accent-soft p-4">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-ink-900">
        <ShieldCheck size={15} className="text-accent" />
        {starting ? 'Your start code' : 'Your drop-off code'}
      </p>
      <p className="my-2 font-display text-3xl font-bold tracking-[0.3em] text-accent">{code}</p>
      <p className="text-xs text-ink-600">
        {starting
          ? 'Read this to your driver once you are in the right cab.'
          : 'Share this only when the fare matches what you agreed.'}
      </p>
    </div>
  );
}

function ActivePanel({ ride, driverLoc, otp, onChange }) {
  const cancel = useMutation({
    mutationFn: () => api.patch(`/customer/rides/${ride._id}/cancel`, { reason: 'Changed plans' }),
    onSuccess: (res) => { toast.success(res.refund?.reasonLabel || 'Ride cancelled'); onChange(); },
    onError: (err) => toast.error(err.message),
  });

  const loc = driverLoc || ride.driverLocation;

  return (
    <Card>
      <CardHeader
        title={ride.status === 'ongoing' ? 'Your ride is on the way' : 'Booking confirmed'}
        subtitle="Contact your driver through a masked number — your real number stays private."
        icon={ShieldCheck}
      />
      <CardBody className="space-y-4">
        {otp && <OtpCallout phase={otp.phase} code={otp.code} />}

        <DriverCard ride={ride} />

        {/* Live tracking: the driver's car on the map, moving as their phone
            reports in. Falls back to a status line until the first fix. */}
        <div className="overflow-hidden rounded-xl border border-ink-200">
          <LiveMap
            position={loc ? { lat: loc.lat, lng: loc.lng } : ride.pickup}
            cars={loc ? [{ id: 'driver', lat: loc.lat, lng: loc.lng, heading: loc.heading, active: true }] : []}
            focusCar={loc}
            className="h-56 w-full"
          />
          <div className="flex items-center gap-3 bg-white px-4 py-3">
            <span className="relative flex h-3 w-3 shrink-0">
              {loc && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />}
              <span className={`relative inline-flex h-3 w-3 rounded-full ${loc ? 'bg-accent' : 'bg-ink-300'}`} />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink-800">
                {loc
                  ? 'Live tracking active'
                  : ride.status === 'ongoing'
                    ? 'Waiting for your driver’s GPS…'
                    : 'Your driver will appear here when the trip starts'}
              </p>
              {loc?.at && (
                <p className="text-xs text-ink-500">Updated {Math.max(0, Math.round((Date.now() - loc.at) / 1000))}s ago</p>
              )}
            </div>
          </div>
        </div>

        <SafetyRow ride={ride} />

        <div className="rounded-xl bg-ink-50 p-4">
          <MoneyRow label="Fare (cash to driver)" value={inr(ride.fareAmount)} />
          <MoneyRow label="Advance fee (paid)" value={inr(ride.feeAmount)} />
        </div>

        {ride.status === 'confirmed' && (
          <Button variant="ghost" className="w-full text-danger" icon={XCircle} loading={cancel.isPending} onClick={() => cancel.mutate()}>
            Cancel booking
          </Button>
        )}
      </CardBody>
    </Card>
  );
}

function CompletedPanel({ ride, onRated }) {
  const [stars, setStars] = useState(5);
  const [comment, setComment] = useState('');
  const rate = useMutation({
    mutationFn: () => api.post(`/customer/rides/${ride._id}/rate`, { stars, comment: comment || undefined }),
    onSuccess: () => { toast.success('Thanks for rating your driver!'); onRated(); },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Card>
      <CardHeader title="Ride completed" subtitle="We hope you had a great trip." icon={CheckCircle2} />
      <CardBody className="space-y-4">
        {ride.driver && <DriverCard ride={ride} />}
        <div className="rounded-xl bg-ink-50 p-4">
          <MoneyRow label="Fare paid (cash)" value={inr(ride.fareAmount)} />
          <MoneyRow label="Advance fee (online)" value={inr(ride.feeAmount)} />
        </div>

        {ride.ratedByCustomer ? (
          <div className="flex items-center gap-2 rounded-xl bg-success-soft p-4 text-sm text-success">
            <CheckCircle2 size={16} /> You've rated this ride. Thank you!
          </div>
        ) : (
          <div className="rounded-xl border border-ink-200 p-4">
            <p className="mb-3 flex items-center gap-1.5 font-medium text-ink-800"><Star size={16} className="text-warning" /> Rate your driver</p>
            <StarPicker value={stars} onChange={setStars} />
            <Field className="mt-3">
              <Textarea placeholder="Share a note about your experience (optional)" value={comment} onChange={(e) => setComment(e.target.value)} />
            </Field>
            <Button className="mt-3" loading={rate.isPending} onClick={() => rate.mutate()}>Submit rating</Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function CancelledPanel({ ride }) {
  return (
    <Card>
      <CardBody>
        <div className="flex items-start gap-3 rounded-xl bg-danger-soft p-4">
          <XCircle size={20} className="mt-0.5 shrink-0 text-danger" />
          <div>
            <p className="font-medium text-ink-900">Ride {RIDE_STATUS_META[ride.status]?.label?.toLowerCase()}</p>
            {ride.cancellation?.reason && <p className="mt-0.5 text-sm text-ink-600">Reason: {ride.cancellation.reason}</p>}
            {ride.cancellation?.refundAmount > 0 && (
              <p className="mt-1 text-sm text-success">Refund of {inr(ride.cancellation.refundAmount)} is being processed (24–48h).</p>
            )}
          </div>
        </div>
        <Link to="/"><Button variant="secondary" className="mt-4 w-full">Book another ride</Button></Link>
      </CardBody>
    </Card>
  );
}

// Celebratory confirmation banner — the single moment the rider has been
// waiting for. Warm gradient, animated entry, sparkles.
function ConfirmedBanner() {
  const t = useTranslations('RideDetail');
  return (
    <div className="relative overflow-hidden rounded-2xl bg-brand-gradient p-5 text-accent-fg shadow-glow animate-scale-in">
      {/* Decorative mandala rings */}
      <span className="pointer-events-none absolute -right-8 -top-8 h-36 w-36 rounded-full border-2 border-white/15" />
      <span className="pointer-events-none absolute -right-4 -top-4 h-24 w-24 rounded-full border border-white/10" />
      <div className="relative flex items-center gap-4">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/20 backdrop-blur">
          <CheckCircle2 size={28} className="text-white" />
        </span>
        <div>
          <p className="flex items-center gap-1.5 font-display text-xl font-bold">
            <Sparkles size={16} className="text-amber-300" />
            {t('confirmedTitle')}
          </p>
          <p className="mt-0.5 text-sm text-white/85">{t('confirmedText')}</p>
        </div>
      </div>
    </div>
  );
}
