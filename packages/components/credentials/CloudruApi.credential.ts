import { INodeParams, INodeCredential } from '../src/Interface'

class CloudruApiCredential implements INodeCredential {
    label: string
    name: string
    version: number
    description: string
    inputs: INodeParams[]

    constructor() {
        this.label = 'Cloud.ru API'
        this.name = 'cloudruApi'
        this.version = 1.0
        this.description =
            'Get your API key from the <a target="_blank" href="https://cloud.ru/">Cloud.ru</a> Foundation Models console (Evolution AI Factory).'
        this.inputs = [
            {
                label: 'Cloud.ru API Key',
                name: 'cloudruApiKey',
                type: 'password'
            }
        ]
    }
}

module.exports = { credClass: CloudruApiCredential }
