"use client"
import React, { useState } from "react";
import Container from '@cloudscape-design/components/container';
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import { StorageManager } from '@aws-amplify/ui-react-storage';
import { withAuth } from '@/components/WithAuth';

import '@aws-amplify/ui-react/styles.css';

const DefaultStorageManagerExample = () => {
    const [uploadTargetUwiNumber, setUploadTargetUwiNumber] = useState('')
    const [uploadTargetWellField ] = useState('SanJuanEast') //TODO, let user change the field name. setUploadTargetWellField
    return (

        <Container>

            <FormField label="Well API Number">
                <Input
                    onChange={({ detail }) => setUploadTargetUwiNumber(detail.value)}
                    value={uploadTargetUwiNumber}
                    placeholder="Enter Well API Number (ex: 12-123-12345)"
                />
            </FormField>
            
            <StorageManager
                acceptedFileTypes={['.pdf']}
                path={`production-agent/well-files/field=${uploadTargetWellField}/uwi=${uploadTargetUwiNumber}/`}
                maxFileCount={1000}
                isResumable
            />
        </Container>

    );
};

export default withAuth(DefaultStorageManagerExample)
