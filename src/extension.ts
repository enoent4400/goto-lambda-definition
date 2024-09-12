import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs/promises'
import * as fsSync from 'fs'
import * as yaml from 'js-yaml'

const cfnTags = [
  '!Ref', '!Sub', '!GetAtt', '!Join', '!If', '!Not', '!Or', '!And',
  '!Condition', '!FindInMap', '!Select', '!Split', '!ImportValue', '!Equals', '!If'
]

const customScalarTypes = cfnTags.map(tag => new yaml.Type(tag, { kind: 'scalar' }))
const customSequenceTypes = cfnTags.map(tag => new yaml.Type(tag, { kind: 'sequence' }))

const customTypes = [...customScalarTypes, ...customSequenceTypes]

const CFN_SCHEMA = yaml.DEFAULT_SCHEMA.extend(customTypes)

function getLambdaName(filePath: string): string | null {
  const parts = filePath.split(path.sep)
  const fileName = path.basename(filePath)
  
  if (fileName === 'lambda.ts') {
      return parts[parts.length - 2]
  }
  
  const parentDir = parts[parts.length - 2]
  if (['lib', 'tests', 'test'].includes(parentDir)) {
      return parts[parts.length - 3]
  }
  
  return null
}

function findTemplateYaml(startPath: string): string | null {
  let currentPath = startPath
  while (currentPath !== path.parse(currentPath).root) {
      const templatePath = path.join(currentPath, 'template.yaml')
      if (fsSync.existsSync(templatePath)) {
          return templatePath
      }
      currentPath = path.dirname(currentPath)
  }
  return null
}

export function activate(context: vscode.ExtensionContext) {
  let disposable = vscode.commands.registerCommand('extension.goToLambdaDefinition', async () => {
    const editor = vscode.window.activeTextEditor
    if (!editor) {
      vscode.window.showErrorMessage('No active editor')
      return
    }

 
    const currentFile = editor.document.fileName
    const lambdaName = getLambdaName(currentFile)

    if (!lambdaName) {
      vscode.window.showErrorMessage('Unable to determine Lambda name from file structure')
      return
    }

    
    const templatePath = findTemplateYaml(path.dirname(currentFile))

    if (!templatePath) {
        vscode.window.showErrorMessage('template.yaml not found in any parent directory')
        return
    }

    try {
      await fs.access(templatePath)
    } catch (err) {
      vscode.window.showErrorMessage('template.yaml not found')
      return
    }

    const templateContent = await fs.readFile(templatePath, 'utf-8')

    let template
    try {
      template = yaml.load(templateContent, { schema: CFN_SCHEMA }) as any
      
    } catch (error) {
      vscode.window.showErrorMessage(`Error parsing template.yaml: ${error}`)
      return
      
    }
    const resources = template.Resources
    if (!resources) {
      vscode.window.showErrorMessage('Resources not found in template.yaml')
      return
    }
    console.log('resources', resources)
    const lambdaResource = Object.entries(resources).find(([_, resource]: [string, any]) => 
      resource.Type === 'AWS::Serverless::Function' && 
      resource.Properties.CodeUri.includes(lambdaName)
    )

    console.log('lambdaResource', lambdaResource)

    if (!lambdaResource) {
      vscode.window.showErrorMessage('Lambda definition not found in template.yaml')
      return
    }

    const document = await vscode.workspace.openTextDocument(templatePath)
    const templateEditor = await vscode.window.showTextDocument(document)

    const text = document.getText()
    const position = text.indexOf(lambdaResource[0])
    const newPosition = document.positionAt(position)

    
    
    templateEditor.selection = new vscode.Selection(newPosition, newPosition)
    //also center the view on the new position
    templateEditor.revealRange(new vscode.Range(newPosition, newPosition), vscode.TextEditorRevealType.InCenter)

  })

  context.subscriptions.push(disposable)
}