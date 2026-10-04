import { Coupon, CouponRedemption, catchAsync, ApiError, ok, created, paginate, pageMeta } from '@yatracab/core';

// GET /admin/coupons
export const listCoupons = catchAsync(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const filter = {};
  if (req.query.active === 'true') filter.active = true;
  if (req.query.active === 'false') filter.active = false;
  if (req.query.q) filter.code = new RegExp(String(req.query.q).trim(), 'i');

  const [coupons, total] = await Promise.all([
    Coupon.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean({ virtuals: true }),
    Coupon.countDocuments(filter),
  ]);

  return ok(res, {
    coupons: coupons.map((c) => ({ ...c, remaining: Math.max(0, c.totalCoupons - c.usedCount) })),
    ...pageMeta(total, page, limit),
  });
});

// GET /admin/coupons/:id — with who redeemed it
export const getCoupon = catchAsync(async (req, res) => {
  const coupon = await Coupon.findById(req.params.id).lean();
  if (!coupon) throw ApiError.notFound('Coupon not found');
  const redemptions = await CouponRedemption.find({ coupon: coupon._id })
    .sort({ createdAt: -1 })
    .limit(50)
    .populate('user', 'name phone')
    .lean();
  return ok(res, {
    coupon: { ...coupon, remaining: Math.max(0, coupon.totalCoupons - coupon.usedCount) },
    redemptions,
  });
});

// POST /admin/coupons
export const createCoupon = catchAsync(async (req, res) => {
  const code = String(req.body.code).toUpperCase().trim();
  if (await Coupon.exists({ code })) throw ApiError.conflict('That code already exists');
  const coupon = await Coupon.create({ ...req.body, code });
  return created(res, { coupon });
});

// PATCH /admin/coupons/:id
export const updateCoupon = catchAsync(async (req, res) => {
  const coupon = await Coupon.findById(req.params.id);
  if (!coupon) throw ApiError.notFound('Coupon not found');

  // Stock can be raised at any time, but never cut below what is already out.
  if (req.body.totalCoupons != null && req.body.totalCoupons < coupon.usedCount) {
    throw ApiError.badRequest(`${coupon.usedCount} already redeemed — stock cannot go below that`);
  }
  // The code is what riders have been given; changing it would orphan them.
  const { code, usedCount, ...patch } = req.body;
  Object.assign(coupon, patch);
  await coupon.save();
  return ok(res, { coupon });
});

// DELETE /admin/coupons/:id — deactivates rather than deletes, so the audit
// trail of who redeemed what survives.
export const deactivateCoupon = catchAsync(async (req, res) => {
  const coupon = await Coupon.findByIdAndUpdate(req.params.id, { active: false }, { new: true });
  if (!coupon) throw ApiError.notFound('Coupon not found');
  return ok(res, { coupon, message: 'Coupon deactivated' });
});
