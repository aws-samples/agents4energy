declare module "*.png" {
  const content: {
    src: string;
    height: number;
    width: number;
    blurDataURL?: string;
  };
  export default content;
}

declare module "*.jpg" {
  const content: {
    src: string;
    height: number;
    width: number;
    blurDataURL?: string;
  };
  export default content;
}

declare module "*.svg" {
  const content: {
    src: string;
    height: number;
    width: number;
    blurDataURL?: string;
  };
  export default content;
}

declare module "*.gif" {
  const content: {
    src: string;
    height: number;
    width: number;
    blurDataURL?: string;
  };
  export default content;
}

declare module "*.json" {
  const value: any;
  export default value;
}