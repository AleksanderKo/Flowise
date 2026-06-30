import { ICommonObject, INode, INodeData, INodeOutputsValue, INodeParams } from '../../../src/Interface'
import { handleDocumentLoaderDocuments, handleDocumentLoaderMetadata, handleDocumentLoaderOutput } from '../../../src/utils'
import { getAWSCredentialConfig } from '../../../src/awsToolsUtils'
import { getSafeFilePath } from '../../../src/validator'
import { S3Client, GetObjectCommand, S3ClientConfig, ListObjectsV2Command, ListObjectsV2Output } from '@aws-sdk/client-s3'
import { Readable } from 'node:stream'
import * as fsDefault from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

import { DirectoryLoader } from '@langchain/classic/document_loaders/fs/directory'
import { JSONLoader } from '@langchain/classic/document_loaders/fs/json'
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf'
import { DocxLoader } from '@langchain/community/document_loaders/fs/docx'
import { TextLoader } from '@langchain/classic/document_loaders/fs/text'
import { TextSplitter } from '@langchain/textsplitters'
import { CSVLoader } from '../Csv/CsvLoader'
import { LoadOfSheet } from '../MicrosoftExcel/ExcelLoader'
import { PowerpointLoader } from '../MicrosoftPowerpoint/PowerpointLoader'

class S3Storage_DocumentLoaders implements INode {
    label: string
    name: string
    version: number
    description: string
    type: string
    icon: string
    category: string
    baseClasses: string[]
    credential: INodeParams
    inputs?: INodeParams[]
    outputs: INodeOutputsValue[]

    constructor() {
        this.label = 'S3 Universal Directory'
        this.name = 'S3Storage'
        this.version = 1.0
        this.type = 'Document'
        this.icon = 's3.svg'
        this.category = 'Document Loaders'
        this.description = 'Load all files from any S3-compatible bucket (AWS, Cloud.ru, MinIO, etc.) under a given prefix'
        this.baseClasses = [this.type]
        this.credential = {
            label: 'Credential',
            name: 'credential',
            type: 'credential',
            credentialNames: ['awsApi'],
            optional: true
        }
        this.inputs = [
            {
                label: 'Text Splitter',
                name: 'textSplitter',
                type: 'TextSplitter',
                optional: true
            },
            {
                label: 'Bucket',
                name: 'bucketName',
                type: 'string'
            },
            {
                label: 'Prefix',
                name: 'prefix',
                type: 'string',
                description: 'Folder prefix; leave empty to load the entire bucket',
                placeholder: 'docs/',
                optional: true
            },
            {
                label: 'Region',
                name: 'region',
                type: 'string',
                default: 'ru-central-1',
                description: 'Region of the S3 bucket. Plain text so any value works for S3-compatible storages (e.g. ru-central-1).'
            },
            {
                label: 'Endpoint',
                name: 'endpoint',
                type: 'string',
                description: 'Custom S3-compatible endpoint. Leave empty to use AWS.',
                placeholder: 'https://s3.cloud.ru',
                optional: true,
                additionalParams: true
            },
            {
                label: 'Force Path Style',
                name: 'forcePathStyle',
                type: 'boolean',
                description: 'Use path-style addressing (bucket in the URL path). Required by many S3-compatible storages.',
                default: false,
                optional: true,
                additionalParams: true
            },
            {
                label: 'Max Files',
                name: 'maxFiles',
                type: 'number',
                description: 'Optional limit on the number of files to load, to avoid running out of memory on large buckets',
                optional: true,
                additionalParams: true
            },
            {
                label: 'Pdf Usage',
                name: 'pdfUsage',
                type: 'options',
                options: [
                    {
                        label: 'One document per page',
                        name: 'perPage'
                    },
                    {
                        label: 'One document per file',
                        name: 'perFile'
                    }
                ],
                default: 'perPage',
                optional: true,
                additionalParams: true
            },
            {
                label: 'Additional Metadata',
                name: 'metadata',
                type: 'json',
                description: 'Additional metadata to be added to the extracted documents',
                optional: true,
                additionalParams: true
            },
            {
                label: 'Omit Metadata Keys',
                name: 'omitMetadataKeys',
                type: 'string',
                rows: 4,
                description:
                    'Each document loader comes with a default set of metadata keys that are extracted from the document. You can use this field to omit some of the default metadata keys. The value should be a list of keys, seperated by comma. Use * to omit all metadata keys execept the ones you specify in the Additional Metadata field',
                placeholder: 'key1, key2, key3.nestedKey1',
                optional: true,
                additionalParams: true
            }
        ]
        this.outputs = [
            {
                label: 'Document',
                name: 'document',
                description: 'Array of document objects containing metadata and pageContent',
                baseClasses: [...this.baseClasses, 'json']
            },
            {
                label: 'Text',
                name: 'text',
                description: 'Concatenated string from pageContent of documents',
                baseClasses: ['string', 'json']
            }
        ]
    }

    async init(nodeData: INodeData, _: string, options: ICommonObject): Promise<any> {
        const textSplitter = nodeData.inputs?.textSplitter as TextSplitter
        const bucketName = nodeData.inputs?.bucketName as string
        const prefix = nodeData.inputs?.prefix as string
        const region = nodeData.inputs?.region as string
        const endpoint = nodeData.inputs?.endpoint as string
        const forcePathStyle = nodeData.inputs?.forcePathStyle as boolean
        const maxFilesInput = nodeData.inputs?.maxFiles
        const pdfUsage = nodeData.inputs?.pdfUsage
        const metadata = nodeData.inputs?.metadata
        const _omitMetadataKeys = nodeData.inputs?.omitMetadataKeys as string
        const output = nodeData.outputs?.output as string

        const maxFiles = maxFilesInput !== undefined && maxFilesInput !== '' ? parseInt(maxFilesInput as string, 10) : undefined

        let credentials: S3ClientConfig['credentials'] | undefined
        if (nodeData.credential) {
            const credentialConfig = await getAWSCredentialConfig(nodeData, options, region)
            credentials = credentialConfig.credentials
        }

        // Build a universal S3 config. Unlike S3Directory, endpoint and forcePathStyle
        // are independent inputs so any S3-compatible storage can be targeted.
        const s3Config: S3ClientConfig = {
            region: region,
            credentials: credentials,
            // Newer AWS SDK v3 defaults (WHEN_SUPPORTED) add x-amz-checksum-* / flexible-checksum
            // headers that some S3-compatible storages don't support. Only send/validate checksums
            // when the API actually requires them, for broad S3-compatibility.
            requestChecksumCalculation: 'WHEN_REQUIRED',
            responseChecksumValidation: 'WHEN_REQUIRED'
        }
        if (endpoint) {
            s3Config.endpoint = endpoint
        }
        if (forcePathStyle) {
            s3Config.forcePathStyle = forcePathStyle
        }

        const tempDir = fsDefault.mkdtempSync(path.join(os.tmpdir(), 's3storageloader-'))

        try {
            const s3Client = new S3Client(s3Config)

            // List every object under the prefix, paginating through ContinuationToken
            let keys: string[] = []
            let continuationToken: string | undefined = undefined
            do {
                const listObjectsOutput: ListObjectsV2Output = await s3Client.send(
                    new ListObjectsV2Command({
                        Bucket: bucketName,
                        Prefix: prefix,
                        ContinuationToken: continuationToken
                    })
                )

                const pageKeys = (listObjectsOutput?.Contents ?? [])
                    .filter((item) => item.Key && item.ETag)
                    .map((item) => item.Key!)
                    // skip "folder" placeholder keys
                    .filter((key) => !key.endsWith('/'))

                keys = keys.concat(pageKeys)

                continuationToken = listObjectsOutput.IsTruncated ? listObjectsOutput.NextContinuationToken : undefined

                if (maxFiles !== undefined && keys.length >= maxFiles) {
                    keys = keys.slice(0, maxFiles)
                    break
                }
            } while (continuationToken)

            await Promise.all(
                keys.map(async (key) => {
                    const filePath = getSafeFilePath(tempDir, key)
                    try {
                        const response = await s3Client.send(
                            new GetObjectCommand({
                                Bucket: bucketName,
                                Key: key
                            })
                        )

                        const objectData = await new Promise<Buffer>((resolve, reject) => {
                            const chunks: Buffer[] = []

                            if (response.Body instanceof Readable) {
                                response.Body.on('data', (chunk: Buffer) => chunks.push(chunk))
                                response.Body.on('end', () => resolve(Buffer.concat(chunks)))
                                response.Body.on('error', reject)
                            } else {
                                reject(new Error('Response body is not a readable stream.'))
                            }
                        })

                        // create the directory if it doesnt already exist
                        fsDefault.mkdirSync(path.dirname(filePath), { recursive: true })

                        // write the file to the directory
                        fsDefault.writeFileSync(filePath, objectData)
                    } catch (e: any) {
                        throw new Error(`Failed to download file ${key} from S3 bucket ${bucketName}: ${e.message}`)
                    }
                })
            )

            const loader = new DirectoryLoader(
                tempDir,
                {
                    '.json': (path) => new JSONLoader(path),
                    '.txt': (path) => new TextLoader(path),
                    '.csv': (path) => new CSVLoader(path),
                    '.xls': (path) => new LoadOfSheet(path),
                    '.xlsx': (path) => new LoadOfSheet(path),
                    '.xlsm': (path) => new LoadOfSheet(path),
                    '.xlsb': (path) => new LoadOfSheet(path),
                    '.docx': (path) => new DocxLoader(path),
                    '.ppt': (path) => new PowerpointLoader(path),
                    '.pptx': (path) => new PowerpointLoader(path),
                    '.pdf': (path) =>
                        new PDFLoader(path, {
                            splitPages: pdfUsage !== 'perFile',
                            // @ts-ignore
                            pdfjs: () => import('pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js')
                        }),
                    '.aspx': (path) => new TextLoader(path),
                    '.asp': (path) => new TextLoader(path),
                    '.cpp': (path) => new TextLoader(path), // C++
                    '.c': (path) => new TextLoader(path),
                    '.cs': (path) => new TextLoader(path),
                    '.css': (path) => new TextLoader(path),
                    '.go': (path) => new TextLoader(path), // Go
                    '.h': (path) => new TextLoader(path), // C++ Header files
                    '.kt': (path) => new TextLoader(path), // Kotlin
                    '.java': (path) => new TextLoader(path), // Java
                    '.js': (path) => new TextLoader(path), // JavaScript
                    '.less': (path) => new TextLoader(path), // Less files
                    '.ts': (path) => new TextLoader(path), // TypeScript
                    '.php': (path) => new TextLoader(path), // PHP
                    '.proto': (path) => new TextLoader(path), // Protocol Buffers
                    '.python': (path) => new TextLoader(path), // Python
                    '.py': (path) => new TextLoader(path), // Python
                    '.rst': (path) => new TextLoader(path), // reStructuredText
                    '.ruby': (path) => new TextLoader(path), // Ruby
                    '.rb': (path) => new TextLoader(path), // Ruby
                    '.rs': (path) => new TextLoader(path), // Rust
                    '.scala': (path) => new TextLoader(path), // Scala
                    '.sc': (path) => new TextLoader(path), // Scala
                    '.scss': (path) => new TextLoader(path), // Sass
                    '.sol': (path) => new TextLoader(path), // Solidity
                    '.sql': (path) => new TextLoader(path), //SQL
                    '.swift': (path) => new TextLoader(path), // Swift
                    '.markdown': (path) => new TextLoader(path), // Markdown
                    '.md': (path) => new TextLoader(path), // Markdown
                    '.tex': (path) => new TextLoader(path), // LaTeX
                    '.ltx': (path) => new TextLoader(path), // LaTeX
                    '.html': (path) => new TextLoader(path), // HTML
                    '.vb': (path) => new TextLoader(path), // Visual Basic
                    '.xml': (path) => new TextLoader(path) // XML
                },
                true
            )

            let docs = await handleDocumentLoaderDocuments(loader, textSplitter)

            docs = handleDocumentLoaderMetadata(docs, _omitMetadataKeys, metadata)

            return handleDocumentLoaderOutput(docs, output)
        } catch (e: any) {
            throw new Error(`Failed to load data from bucket ${bucketName}: ${e.message}`)
        } finally {
            // remove the temp directory before returning docs
            fsDefault.rmSync(tempDir, { recursive: true })
        }
    }
}

module.exports = { nodeClass: S3Storage_DocumentLoaders }
