/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: false,
    transpilePackages: ['@cubica/sdk-core', '@cubica/react-sdk', '@cubica/sdk-shared'],
    experimental: {
        externalDir: true,
    },
};

export default nextConfig;
