const config = {
  '*.{ts,tsx,js,jsx}': ['eslint --fix', 'prettier --write'],
  '*.{json,md,css,yml}': ['prettier --write'],
};

export default config;
