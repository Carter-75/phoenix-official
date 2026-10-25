const LocalStrategy = require('passport-local').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const JwtStrategy = require('passport-jwt').Strategy;
const ExtractJwt = require('passport-jwt').ExtractJwt;
const User = require('../models/user');

module.exports = function(passport) {
  // JWT Strategy
  const opts = {
    jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
    secretOrKey: process.env.SESSION_SECRET || 'secret'
  };

  passport.use(new JwtStrategy(opts, async (jwt_payload, done) => {
    try {
      if (jwt_payload.isTemp) {
        return done(null, jwt_payload);
      }
      const user = await User.findById(jwt_payload.id);
      if (user) {
        return done(null, user);
      }
      return done(null, false);
    } catch (err) {
      return done(err, false);
    }
  }));

  // Local Strategy
  passport.use(
    new LocalStrategy({ usernameField: 'email' }, async (email, password, done) => {
      try {
        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user) return done(null, false, { message: 'USER_NOT_FOUND' });
        if (!user.password) return done(null, false, { message: 'Please login with Google.' });

        const isMatch = await user.comparePassword(password);
        if (!isMatch) return done(null, false, { message: 'Incorrect email or password.' });

        return done(null, user);
      } catch (err) {
        return done(err);
      }
    })
  );

  // Google Strategy
  if (process.env.GOOGLE_CLIENT_ID) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          callbackURL: '/api/auth/google/callback',
          proxy: true
        },
        async (accessToken, refreshToken, profile, done) => {
          try {
            let user = await User.findOne({ googleId: profile.id });
            if (!user && profile.emails && profile.emails.length > 0) {
                user = await User.findOne({ email: profile.emails[0].value.toLowerCase() });
            }
            
            if (user) {
              if (!user.googleId) {
                user.googleId = profile.id;
                await user.save();
              }
              return done(null, user);
            } else {
              // No user exists, pass a temp profile to trigger username selection
              return done(null, {
                 isTemp: true,
                 googleId: profile.id,
                 email: profile.emails ? profile.emails[0].value : undefined
              });
            }
          } catch (err) {
            return done(err);
          }
        }
      )
    );
  }
};
