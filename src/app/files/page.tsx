"use client"
import React, { useEffect, useState } from "react";
import Container from '@cloudscape-design/components/container';
// import S3ResourceSelector from "@cloudscape-design/components/s3-resource-selector";
// import FileUpload from "@cloudscape-design/components/file-upload";
import FormField from "@cloudscape-design/components/form-field";
// import Input from "@cloudscape-design/components/input";

import styles from './page.module.css'
// import './page.module.css'

import { list, remove, ListPaginateWithPathInput } from 'aws-amplify/storage';
// import { it } from "node:test";
// import { useAuthenticator } from '@aws-amplify/ui-react';
// import { redirect } from 'next/navigation';

import { withAuth } from '@/components/WithAuth';

//https://aws-amplify.github.io/amplify-js/api/
//https://docs.amplify.aws/nextjs/build-a-backend/storage/list-files/

interface S3Asset {
  Key: string;
  Size: number | undefined;
  IsFolder: boolean;
}

const onFetchObjects = async (pathPrefix: string): Promise<readonly S3Asset[]> => {
  console.log('pathPrefix', pathPrefix)
  try {

    const result = await list({
      path: pathPrefix || "well-files/",
      pageSize: 10,
      options: {
        subpathStrategy: { strategy: 'exclude' }
      },
      // nextToken: nextToken
    } as ListPaginateWithPathInput);

    console.log('list result: ', result)

    const objects: S3Asset[] = result.items.map((item) => ({
      Key: item.path,
      Size: item.size,
      IsFolder: false
    }));

    if (result.excludedSubpaths) {
      const folders: S3Asset[] = result.excludedSubpaths.map((item) => {
        return {
          Key: item.substring(pathPrefix.length),
          Size: undefined,
          IsFolder: true
        }
      })

      objects.push(...folders)
    }

    return objects

  } catch (error) {
    console.error('Error fetching S3 objects:', error);
    return Promise.resolve([]); // Return an empty array in case of an error
  }
}



function Page() {
  // const PAGE_SIZE = 20;
  // const [resource, setResource] = React.useState({ uri: "" });
  const [s3PathSegments, setS3PathSegments] = React.useState<string[]>(["production-agent/"])
  // const [uploadTargetApiNumber, setUploadTargetApiNumber] = useState('')
  const [s3Assets, setS3Assets] = useState<S3Asset[]>([]);
  // const [selectedObject, setSelectedObject] = useState<string | null>(null);
  // const [nextToken, setNextToken] = useState<string | null>(); // TODO: Impliment Paganation

  useEffect(() => {
    onFetchObjects(s3PathSegments.join("")).then((objects) => {
      setS3Assets([...objects]);
    });
  }, [s3PathSegments]);

  const onRemoveObject = async (key: string) => {
    //Create an alert to confirm the user wants to delete the file
    if (!window.confirm(`Are you sure you want to delete ${key}?`)) return;

    try {
      // Delete the object from s3
      await remove({ path: key });
      // Remove the object from the local state
      setS3Assets(s3Assets.filter((obj) => obj.Key !== key));
    } catch (error) {
      console.error('Error removing S3 object:', error);
    }
  }

  const displayFolderOrObject: React.FC<{ item: S3Asset }> = ({ item }) => {
    console.log(item.Key)
    const pathPrefix = s3PathSegments.join("")
    if (item.IsFolder) {
      return (
        <button key={item.Key}
          onClick={() => setS3PathSegments([...s3PathSegments, item.Key])}>
          <span className={styles['icon']}>📁</span>ƒ
          {item.Key}
        </button>
      )
    } else {
      return <a href={`/files/${item.Key}`} target="_blank">
        <span className={styles['icon']}>📄</span>
        {item.Key.substring(pathPrefix.length)}
      </a>
    }
  }

  return (
    <Container>
      <FormField
        label="View Files"
      >
        {/* <b>{s3PathSegments}</b> */}

        <ul
          className={styles['horizontal-list']}
        >
          {
            s3PathSegments.map((item, index) => (
              <li key={index} className={styles['horizontal-list-item']}
                onClick={() => setS3PathSegments(s3PathSegments.slice(0, index + 1))}>
                {item}
              </li>
            ))
          }
        </ul>

        <table className={styles['custom-table']}>
          <thead>
            <tr>
              <th>Name (click to open)</th>
              <th>Size</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {s3Assets.map((item, index) => (
              <tr key={index}>
                <td>{displayFolderOrObject({ item })}</td>
                <td>{item.Size}</td>
                <td>
                  {!item.IsFolder ? 
                  <button onClick={() => onRemoveObject(item.Key)}>Remove File</button>
                  : ""}
                  
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </FormField>
    </Container>
  );
}

export default withAuth(Page)