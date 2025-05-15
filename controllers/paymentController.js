const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const endpointSecret = process.env.STRIPE_ENDPOINT_SECRET;
const User = require("../models/User");
const AvailableRide = require("../models/AvailableRide");
const BookedRide = require("../models/BookedRide");
const PastRide = require("../models/PastRide");
const Transaction = require("../models/Transaction");
function generateUniqueCode() {
  // Get current timestamp in milliseconds
  const timestamp = new Date().getTime();

  // Convert timestamp to string and remove milliseconds
  const timestampString = timestamp.toString().slice(0, -3);

  // Extract last 6 digits from the timestamp string
  const lastSixDigits = timestampString.slice(-6);

  // Ensure there are no leading zeros
  let uniqueCode = parseInt(lastSixDigits);

  // Check if the unique code has leading zeros
  while (uniqueCode < 100000) {
    // If so, multiply by 10 until it's a 6-digit number
    uniqueCode *= 10;
  }

  return uniqueCode;
}

const checkout = async (req, res) => {
  const data = req.body;

  try {
    const amountInCents = Math.round(parseFloat(data.amount) * 100);

    // Create a Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: data.description,
            },
            unit_amount: Math.min(999999, amountInCents), //max amount 9999usd allowed
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: process.env.CLIENT_URL,
      cancel_url: `${process.env.CLIENT_URL}/paymentFailed`,
      customer_email: data.email,
      payment_intent_data: {
        metadata: {
          key: data.key,
          paidBy: data.userId,
        },
      },
    });

    // Redirect the user to the Checkout page URL
    res.redirect(303, session.url);
  } catch (error) {
    console.error("Error creating session:", error.message);
    res.status(400).json({ error: { message: error.message } });
  }
};

const paymentWebhook = async (request, response) => {
  const sig = request.headers["stripe-signature"];
  console.log("Webhook received with signature:", sig);
  let event;
  //console.log('request.body',request.body);
  try {
    event = stripe.webhooks.constructEvent(
      request.rawBody,
      sig,
      endpointSecret
    );
    console.log("Constructed event:", event);
  } catch (err) {
    console.error("Webhook Error:", err.message);
    return response.status(400).send(`Webhook Error: ${err.message}`);
  }
  //console.log(event);

  console.log("Received event type:", event.type);
  console.log("Event data:", event.data.object);

  try {
    switch (event.type) {
      case "payment_intent.succeeded":
        console.log("Handling payment_intent.succeeded event");
        const session = event.data.object;
        const customData = session.metadata;
        console.log("Session metadata:", customData);

        const user = await User.findById(customData.paidBy);
        if (!user) {
          console.error("User not found for ID:", customData.paidBy);
          break;
        }
        console.log("User found:", user);

        const value = user.pendingPayments.get(customData.key);
        if (!value) {
          console.error("Pending payment not found for key:", customData.key);
          break;
        }
        console.log("Pending payment value:", value);

        user.pendingPayments.delete(customData.key);
        await user.save();
        console.log("User pendingPayments updated successfully");

        const availableRide = await AvailableRide.findById(value.rideId);
        if (!availableRide) {
          console.error("Available ride not found for ID:", value.rideId);
          break;
        }
        console.log("Available ride found:", availableRide);

        availableRide.availableSeats -= value.seats;
        await availableRide.save();
        console.log("Available ride seats updated successfully");

        const driver = await User.findById(availableRide.driverId);
        if (!driver) {
          console.error("Driver not found for ID:", availableRide.driverId);
          break;
        }
        console.log("Driver found:", driver);

        const transaction = new Transaction({
          intentId: session.id,
          paidBy: customData.paidBy,
          paidTo: availableRide.driverId,
          amountPaid: session.amount / 100,
          unitCost: value.unitCost,
          distance: value.distance,
          seats: value.seats,
          rideId: value.rideId,
          driverName: driver.name,
          source: value.pickUpAddress,
          destination: value.destinationAddress,
          latest_charge: session.latest_charge,
        });
        await transaction.save();
        console.log("Transaction saved successfully:", transaction);

        const pastRide = new PastRide({
          rideId: value.rideId,
          userId: customData.paidBy,
          source: value.pickUpAddress,
          destination: value.destinationAddress,
          user: "passenger",
          rating: {},
          overview_polyline: availableRide.overview_polyline,
          sourceCo: value.pickUp,
          destinationCo: value.destination,
        });
        await pastRide.save();
        console.log("Past ride saved successfully:", pastRide);

        const bookedRide = new BookedRide({
          rideId: value.rideId,
          passengerId: customData.paidBy,
          seats: value.seats,
          pickUp: value.pickUp,
          destination: value.destination,
          pickUpAddress: value.pickUpAddress,
          destinationAddress: value.destinationAddress,
          pickUpDate: value.pickUpDate,
          pickUpTime: value.pickUpTime,
          unitCost: value.unitCost,
          distance: value.distance,
          transactionId: transaction._id,
          verificationCode: generateUniqueCode(),
          vehicleType: availableRide.vehicleType,
          overview_polyline: availableRide.overview_polyline,
          passengerName: user.name,
          passengerImageUrl: user.imageUrl,
          driverId: availableRide.driverId,
          driverName: driver.name,
          driverImageUrl: driver.imageUrl,
          pastRideId: pastRide._id,
          driverPastId: availableRide.pastRideId,
        });
        await bookedRide.save();
        console.log("Booked ride saved successfully:", bookedRide);

        break;

      default:
        console.log("Unhandled event type:", event.type);
        break;
    }
  } catch (error) {
    console.error("Error processing event:", error);
    return response
      .status(500)
      .send(`Error processing event: ${error.message}`);
  }

  // Return a 200 response to acknowledge receipt of the event
  response.status(200).send();
};

module.exports = {
  checkout,
  paymentWebhook,
};
