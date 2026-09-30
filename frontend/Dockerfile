FROM node:24-alpine

RUN corepack enable

WORKDIR /app

# Install dependencies first for better layer caching
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn/releases ./.yarn/releases
RUN yarn install --immutable

COPY . .

EXPOSE 5173

CMD ["yarn", "dev", "--host", "0.0.0.0"]
