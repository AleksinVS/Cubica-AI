module.exports = ({ env }) => ({
    'users-permissions': {
        enabled: true,
        config: {
            jwtSecret: env('JWT_SECRET'),
            expiresIn: '7d',
        },
    },
});
