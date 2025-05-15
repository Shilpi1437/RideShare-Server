const router = require("express").Router();
const { checkout, paymentWebhook } = require('../controllers/paymentController');
const verifyJWT = require('../middleware/verifyJWT');

// Route for creating checkout session
router.post("/create-checkout-session", checkout);

// Webhook route for Stripe
router.post("/webhook", require("express").raw({ type: "application/json" }), paymentWebhook);

module.exports = router;
