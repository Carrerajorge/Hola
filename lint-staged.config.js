export default {
    "*.{js,jsx,ts,tsx}": (filenames) => {
        const files = filenames.map(f => `"${f}"`).join(" ");
        return [`bash -c 'eslint --fix ${files} || true'`];
    }
};
